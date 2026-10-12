import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { embedTexts, generateJson, GEMINI_MODEL } from "@/lib/gemini";
import { centerVectors, clusterVectors } from "@/nlp/cluster";
import { buildCommentContent, COMMENT_PROMPT_VERSION, commentItemsSchema, commentJsonSchema, SYSTEM_INSTRUCTION, usableComments, verifyItems, type Comment, type VerifiedItem } from "@/nlp/comments";
import { yt } from "@/services/youtube";

type Row = Record<string, unknown>;
async function rows<T = Row>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

// Cost control: one commentThreads call is 1 quota unit and returns up to 100 top-level comments, so each analysed video
// costs 1 unit plus one Gemini call. Only videos with enough comments to show a pattern are read.
export const SAMPLE_SIZE = 100;
export const MIN_VIDEO_COMMENTS = 20;

type ThreadsResponse = { items: { id: string; snippet: { topLevelComment: { snippet: { textOriginal?: string; textDisplay?: string; likeCount?: number } } } }[] };

/** A bounded sample of public top-level comments, most relevant first (YouTube's own ranking). Returns [] if comments are off. */
export async function fetchTopComments(videoId: string, max = SAMPLE_SIZE): Promise<{ comments: Comment[]; disabled: boolean }> {
  try {
    const r = await yt<ThreadsResponse>("commentThreads", { part: "snippet", videoId, order: "relevance", maxResults: String(Math.min(100, max)), textFormat: "plainText" });
    const comments = r.items.map((i, n) => ({ id: `c${n + 1}`, text: i.snippet.topLevelComment.snippet.textOriginal ?? i.snippet.topLevelComment.snippet.textDisplay ?? "", likes: i.snippet.topLevelComment.snippet.likeCount ?? 0 }));
    return { comments, disabled: false };
  } catch (e) {
    if (e instanceof Error && /commentsDisabled|disabled comments|403/.test(e.message) && /comment/i.test(e.message)) return { comments: [], disabled: true };
    throw e;
  }
}

export type VideoAnalysis = { items: VerifiedItem[]; rejected: number; sampleSize: number };

/** Gemini groups the comments; code verifies every group against the comments before anything is kept. */
export async function analyseComments(title: string, raw: Comment[]): Promise<VideoAnalysis> {
  const comments = usableComments(raw);
  if (comments.length < 10) return { items: [], rejected: 0, sampleSize: comments.length };
  const res = await generateJson({ system: SYSTEM_INSTRUCTION, content: buildCommentContent(title, comments), jsonSchema: commentJsonSchema });
  const parsed = commentItemsSchema.parse(JSON.parse(res.text));
  const { verified, rejected } = verifyItems(parsed.items, comments);
  return { items: verified, rejected, sampleSize: comments.length };
}

/** Analyse the most-discussed recent videos that have not been analysed yet. Bounded by `maxVideos`. */
export async function runAudienceAnalysis(opts: { maxVideos?: number; force?: boolean } = {}) {
  const maxVideos = opts.maxVideos ?? 8;
  const candidates = await rows<{ id: number; external_id: string; title: string; comments: number }>(sql`
    select s.id, s.external_id, coalesce(s.title, e.title) as title, m.comments
    from episode_sources s
    join episodes e on e.id = s.episode_id
    join podcasts p on p.id = e.podcast_id and p.enabled
    join lateral (select comments from episode_metric_snapshots where episode_source_id = s.id order by captured_on desc limit 1) m on true
    left join audience_findings f on f.episode_source_id = s.id and f.prompt_version = ${COMMENT_PROMPT_VERSION}
    where s.kind = 'youtube' and e.published_at >= now() - interval '45 days' and m.comments >= ${MIN_VIDEO_COMMENTS}
      ${opts.force ? sql`` : sql`and f.id is null`}
    order by m.comments desc limit ${maxVideos}`);
  const out = { videos: candidates.length, analysed: 0, items: 0, rejected: 0, commentsDisabled: 0, errors: [] as string[] };
  for (const v of candidates) {
    try {
      const { comments, disabled } = await fetchTopComments(v.external_id);
      if (disabled) {
        out.commentsDisabled++;
        continue;
      }
      const a = await analyseComments(v.title, comments);
      const values = { episodeSourceId: v.id, sampleSize: a.sampleSize, totalComments: v.comments, items: a.items, rejected: a.rejected, model: GEMINI_MODEL, promptVersion: COMMENT_PROMPT_VERSION, analysedAt: new Date() };
      await db.insert(schema.audienceFindings).values(values).onConflictDoUpdate({ target: schema.audienceFindings.episodeSourceId, set: values });
      out.analysed++;
      out.items += a.items.length;
      out.rejected += a.rejected;
    } catch (e) {
      out.errors.push(`${v.title.slice(0, 40)}: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
    }
  }
  return out;
}

const SAME_MEANING = 0.35; // on mean-centred embeddings, as for episode clusters

/**
 * Merge per-video findings by meaning, so the same question asked on several videos is one theme with combined support.
 * Support is the sum of the observed comment counts; labels and interview questions stay marked as AI output downstream.
 */
export async function buildAudienceThemes() {
  const finds = await rows<{ podcast: string; items: VerifiedItem[] }>(sql`
    select p.name as podcast, f.items from audience_findings f
    join episode_sources s on s.id = f.episode_source_id join episodes e on e.id = s.episode_id join podcasts p on p.id = e.podcast_id and p.enabled
    where f.analysed_at >= now() - interval '60 days'`);
  const flat = finds.flatMap((f) => (f.items ?? []).map((it) => ({ ...it, podcast: f.podcast })));
  const themes: (typeof schema.audienceThemes.$inferInsert)[] = [];
  for (const kind of ["question", "concern", "topic_request"] as const) {
    const items = flat.filter((i) => i.kind === kind);
    if (!items.length) continue;
    // with very few items there is nothing to centre against: each stays its own theme
    const groups = items.length >= 8 ? clusterVectors(centerVectors(await embedTexts(items.map((i) => i.label), "SEMANTIC_SIMILARITY")), SAME_MEANING).map((g) => g.members) : items.map((_, i) => [i]);
    for (const members of groups) {
      const its = members.map((m) => items[m]).sort((a, b) => b.support - a.support);
      themes.push({
        kind,
        label: its[0].label,
        support: its.reduce((a, i) => a + i.support, 0),
        videos: its.length,
        podcasts: [...new Set(its.map((i) => i.podcast))],
        quotes: its.flatMap((i) => i.quotes).slice(0, 3),
        interviewQuestions: [...new Set(its.map((i) => i.aiInterview).filter(Boolean))].slice(0, 3),
      });
    }
  }
  await db.delete(schema.audienceThemes);
  if (themes.length) await db.insert(schema.audienceThemes).values(themes);
  return { findings: finds.length, items: flat.length, themes: themes.length };
}

export async function topAudienceThemes(limit = 12) {
  return db.select().from(schema.audienceThemes).orderBy(sql`support desc`).limit(limit);
}

export async function audienceStats() {
  const [r] = await rows<{ videos: number; sample: number; last: string | null }>(sql`select count(*)::int videos, coalesce(sum(sample_size), 0)::int sample, max(analysed_at) as last from audience_findings`);
  return r ?? { videos: 0, sample: 0, last: null };
}
