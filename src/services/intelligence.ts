import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { istWeekStart } from "@/lib/weeks";
import {
  DEFAULT_GUEST_RUBRIC,
  DEFAULT_SPONSOR_RUBRIC,
  engagementPer1k,
  evidenceConfidence,
  guestOpportunity,
  median,
  performanceIndex,
  sanitizeWeights,
  sponsorOpportunity,
  viewsPerDay,
  viewVelocity,
  type Confidence,
  type Criterion,
  type RubricWeights,
} from "@/scoring/intelligence";
import { getFocusContext } from "@/services/focus-context";
import { getGuestRadar, getSponsorRadar, getTopicRadar, parsePeriod } from "@/services/radars";

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}
const DAY = 86_400_000;
const MATURE_DAYS = 7;
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const AGE_BAND = 1.6;

// ---------------------------------------------------------------- engagement per episode
export type EpisodePerf = { episodeId: number; podcastId: number; views: number; likes: number | null; comments: number | null; viewsPerDay: number; perf: number | null; per1k: number | null; gained: number | null; velocityPerDay: number | null };

/** Latest public counts per monitored YouTube episode, each compared with its own show's typical views per day. */
export async function getEpisodePerformance(now = new Date()): Promise<Map<number, EpisodePerf>> {
  const latest = await rows<{ source_id: number; episode_id: number; podcast_id: number; published_at: string; views: number; likes: number | null; comments: number | null }>(sql`
    select s.id as source_id, s.episode_id, e.podcast_id, e.published_at, m.views, m.likes, m.comments
    from episode_sources s join episodes e on e.id = s.episode_id join podcasts p on p.id = e.podcast_id and p.enabled
    join lateral (select views, likes, comments from episode_metric_snapshots where episode_source_id = s.id and views is not null order by captured_on desc limit 1) m on true
    where s.kind = 'youtube' and e.published_at >= ${now.toISOString()}::timestamptz - interval '90 days'`);
  const history = await rows<{ source_id: number; on: string; views: number }>(sql`
    select episode_source_id as source_id, captured_on::text as "on", views from episode_metric_snapshots
    where views is not null and captured_on >= (${now.toISOString()}::timestamptz - interval '8 days')::date`);
  const bySource = new Map<number, { on: string; views: number }[]>();
  for (const h of history) (bySource.get(h.source_id) ?? bySource.set(h.source_id, []).get(h.source_id)!).push({ on: h.on, views: h.views });

  // Early views are front-loaded, so views per day falls as a video ages. Each video is therefore compared only with
  // videos of the SAME SHOW at a SIMILAR AGE (within a factor of 1.6), and only once it is MATURE_DAYS old.
  const base = latest.map((r) => {
    const age = (now.getTime() - new Date(r.published_at).getTime()) / DAY;
    return { r, age, vpd: viewsPerDay(r.views, age), mature: age >= MATURE_DAYS };
  });
  const cohortVpds = (b: (typeof base)[number]) => base.filter((o) => o.r.podcast_id === b.r.podcast_id && o.mature && o.age >= b.age / AGE_BAND && o.age <= b.age * AGE_BAND).map((o) => o.vpd);
  const out = new Map<number, EpisodePerf>();
  for (const b of base) {
    const { r, vpd, mature } = b;
    const vel = viewVelocity(bySource.get(r.source_id) ?? []);
    out.set(r.episode_id, {
      episodeId: r.episode_id,
      podcastId: r.podcast_id,
      views: r.views,
      likes: r.likes,
      comments: r.comments,
      viewsPerDay: Math.round(vpd),
      perf: mature ? performanceIndex(vpd, cohortVpds(b)) : null,
      per1k: engagementPer1k(r.views, r.likes, r.comments),
      gained: vel ? vel.gained : null,
      velocityPerDay: vel ? vel.perDay : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- sector trends
export type SectorRow = {
  name: string;
  shows: number;
  episodesThisWeek: number;
  episodesPrevWeek: number;
  momentumPct: number | null;
  trend: string;
  perfIndex: number | null; // median across tagged episodes with data: >1 means they out-perform their shows' norm
  per1k: number | null;
  videosWithEngagement: number;
  viewsGained7d: number | null; // null until two snapshots a day apart exist
  confidence: Confidence;
  focus: boolean;
};

/** Topic momentum (from the data) joined with the engagement of the episodes tagged with it. */
export async function getSectorTrends(opts: { asOf?: Date } = {}): Promise<SectorRow[]> {
  const asOf = opts.asOf ?? new Date();
  const [topics, perf, tagged] = await Promise.all([
    getTopicRadar({ asOf }),
    getEpisodePerformance(asOf),
    rows<{ topic_id: number; episode_id: number; transcript: boolean }>(sql`
      select et.topic_id, et.episode_id, (e.coverage = 'transcript') as transcript from episode_topics et join episodes e on e.id = et.episode_id
      where e.published_at >= ${asOf.toISOString()}::timestamptz - interval '30 days' and e.published_at < ${asOf.toISOString()}::timestamptz`),
  ]);
  return topics.map((t) => {
    const eps = tagged.filter((x) => Number(x.topic_id) === t.id);
    const ps = eps.map((x) => perf.get(Number(x.episode_id))).filter((p): p is EpisodePerf => Boolean(p));
    const gains = ps.map((p) => p.gained).filter((g): g is number => g !== null);
    return {
      name: t.name,
      shows: t.distinctPodcasts,
      episodesThisWeek: t.episodesThisWeek,
      episodesPrevWeek: t.episodesPrevWeek,
      momentumPct: t.momentumPct,
      trend: t.trend,
      perfIndex: r2(median(ps.map((p) => p.perf).filter((x): x is number => x !== null))),
      per1k: r2(median(ps.map((p) => p.per1k).filter((x): x is number => x !== null))),
      videosWithEngagement: ps.length,
      viewsGained7d: gains.length ? gains.reduce((a, b) => a + b, 0) : null,
      confidence: evidenceConfidence({ evidenceItems: t.episodes30d, distinctShows: t.distinctPodcasts, transcriptBacked: eps.some((x) => x.transcript), modelConfidence: t.confidence }),
      focus: t.focus,
    };
  });
}

// ---------------------------------------------------------------- rubrics
const DEFAULTS: Record<string, RubricWeights> = { guest: DEFAULT_GUEST_RUBRIC, sponsor: DEFAULT_SPONSOR_RUBRIC };

export async function getActiveRubric(kind: "guest" | "sponsor") {
  const [row] = await db.select().from(schema.rubricVersions).where(and(eq(schema.rubricVersions.kind, kind), eq(schema.rubricVersions.active, true))).orderBy(desc(schema.rubricVersions.id)).limit(1);
  if (row) return { id: row.id, weights: row.weights as RubricWeights, note: row.note };
  const [created] = await db.insert(schema.rubricVersions).values({ kind, weights: DEFAULTS[kind], note: "Default rubric" }).returning();
  return { id: created.id, weights: created.weights as RubricWeights, note: created.note };
}

/** Add a new rubric version (old versions and their stored scores stay intact). Returns null if the weights are invalid. */
export async function saveRubric(kind: "guest" | "sponsor", input: Record<string, unknown>, note: string) {
  const weights = sanitizeWeights(input, Object.keys(DEFAULTS[kind]));
  if (!weights) return null;
  await db.update(schema.rubricVersions).set({ active: false }).where(eq(schema.rubricVersions.kind, kind));
  const [row] = await db.insert(schema.rubricVersions).values({ kind, weights, note: note.slice(0, 200) || null }).returning();
  return row;
}

// ---------------------------------------------------------------- opportunity scoring
export type OpportunityRow = { kind: string; entityId: number; score: number; criteria: Criterion[]; missing: string[]; confidence: Confidence; rubricVersionId: number };

/**
 * Score the guests and sponsors worth approaching under the active rubric and store the full breakdown. Safe to repeat:
 * one row per (kind, entity, week), overwritten on a re-run.
 */
export async function scoreOpportunities(now = new Date()) {
  const weekStart = istWeekStart(now);
  const fx = await getFocusContext();
  const [gRubric, sRubric, perf] = await Promise.all([getActiveRubric("guest"), getActiveRubric("sponsor"), getEpisodePerformance(now)]);
  const transcriptEps = new Set((await rows<{ id: number }>(sql`select id from episodes where coverage = 'transcript'`)).map((r) => Number(r.id)));

  const guests = (await getGuestRadar({ period: parsePeriod("30d", now), focus: fx })).filter((g) => !g.likelyStaff && !g.needsReview).slice(0, 40);
  const toStore: (typeof schema.opportunityScores.$inferInsert)[] = [];
  const out: OpportunityRow[] = [];
  for (const g of guests) {
    const eids = (g.episodes as unknown as { eid: number }[]).map((e) => Number(e.eid));
    const perfs = eids.map((id) => perf.get(id)?.perf).filter((p): p is number => p !== null && p !== undefined);
    const o = guestOpportunity({ distinctShows: g.distinctPodcasts, appearances: g.appearances, daysSinceLast: Math.max(0, (now.getTime() - new Date(g.lastAt).getTime()) / DAY), focus: g.focus, performanceIndex: r2(median(perfs)), confidence: g.confidence }, gRubric.weights);
    const conf = evidenceConfidence({ evidenceItems: g.rawAppearances, distinctShows: g.distinctPodcasts, transcriptBacked: eids.some((id) => transcriptEps.has(id)), modelConfidence: g.confidence });
    out.push({ kind: "guest", entityId: g.id, score: o.score, criteria: o.criteria, missing: o.missing, confidence: conf, rubricVersionId: gRubric.id });
  }
  const sponsors = (await getSponsorRadar({ period: parsePeriod("90d", now), focus: fx })).slice(0, 30);
  for (const s of sponsors) {
    const o = sponsorOpportunity({ disclosedEpisodes: s.confirmedEpisodes, shows: s.distinctPodcasts, daysSinceLast: Math.max(0, (now.getTime() - new Date(s.lastAt).getTime()) / DAY), focus: s.focus, confidence: s.evidence.length ? s.evidence.reduce((a, e) => a + Number((e as unknown as { confidence?: number }).confidence ?? 0.7), 0) / s.evidence.length : 0.5 }, sRubric.weights);
    const conf = evidenceConfidence({ evidenceItems: s.confirmedEpisodes + s.promoEpisodes, distinctShows: s.distinctPodcasts, transcriptBacked: s.evidence.some((e) => e.src === "transcript"), modelConfidence: 0.7, platformConfirmed: s.platformFlaggedEpisodes > 0 });
    out.push({ kind: "sponsor", entityId: s.id, score: o.score, criteria: o.criteria, missing: o.missing, confidence: conf, rubricVersionId: sRubric.id });
  }
  for (const o of out) toStore.push({ kind: o.kind, entityId: o.entityId, weekStart, score: o.score.toFixed(1), criteria: o.criteria, missing: o.missing, confidence: o.confidence, rubricVersionId: o.rubricVersionId });
  for (const r of toStore) {
    await db.insert(schema.opportunityScores).values(r).onConflictDoUpdate({ target: [schema.opportunityScores.kind, schema.opportunityScores.entityId, schema.opportunityScores.weekStart], set: { score: r.score, criteria: r.criteria, missing: r.missing, confidence: r.confidence, rubricVersionId: r.rubricVersionId, computedAt: new Date() } });
  }
  return { weekStart, guests: guests.length, sponsors: sponsors.length, rubric: { guest: gRubric.id, sponsor: sRubric.id } };
}

/** Latest stored scores with the entity's name, best first. */
export async function latestOpportunities(kind: "guest" | "sponsor", limit = 10) {
  return rows<{ entity_id: number; name: string; company: string | null; score: string; criteria: Criterion[]; missing: string[]; confidence: Confidence; rubric_version_id: number; week_start: string }>(sql`
    select o.entity_id, ${kind === "guest" ? sql`g.canonical_name` : sql`b.canonical_name`} as name, ${kind === "guest" ? sql`g.company` : sql`null`} as company,
           o.score, o.criteria, o.missing, o.confidence, o.rubric_version_id, o.week_start::text
    from opportunity_scores o
    ${kind === "guest" ? sql`join guests g on g.id = o.entity_id` : sql`join brands b on b.id = o.entity_id`}
    where o.kind = ${kind} and o.week_start = (select max(week_start) from opportunity_scores where kind = ${kind})
    order by o.score desc limit ${limit}`);
}
