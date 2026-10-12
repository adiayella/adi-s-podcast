import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isUnexpectedTopic } from "@/research/focus";
import type { ResearchConfig } from "@/research/config";
import { normalize } from "@/nlp/verify";
import { selectTopics } from "@/nlp/topics";

// Everything here reads ONLY the discovery tables. Nothing joins the monitored `episodes`, `guests` or
// `brands` tables, so a discovered show can never change a monitored cross-show count or ranking.

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

export type CandidateRow = {
  id: number;
  name: string;
  publisher: string | null;
  source: string;
  rssUrl: string | null;
  youtubeChannelId: string | null;
  language: string | null;
  genre: string | null;
  status: string;
  foundVia: string | null;
  metrics: { episodes30d: number; episodes90d: number; avgGapDays: number | null; daysSinceLast: number | null; regular: boolean; relevantEpisodes90d: number; relevantEpisodes30d: number; relevantEpisodesPrev30d: number } | null;
  engagement: { medianViews: number | null; recentMedianViews: number | null; earlierMedianViews: number | null; videos: number } | null;
  relevance: number | null;
  relevanceDetail: { matchedInterests: string[]; components: Record<string, number> } | null;
  trendLabel: string | null;
  trendEvidence: { signals: { name: string; met: boolean; detail: string }[]; signalsMet: number } | null;
  reason: string | null;
  evidenceEpisodes: { title: string; url: string | null; at: string }[] | null;
  promotedPodcastId: number | null;
  firstSeenAt: string;
  lastEvaluatedAt: string | null;
};

export async function listCandidates(statuses: string[]): Promise<CandidateRow[]> {
  const list = sql.join(statuses.map((s) => sql`${s}`), sql`, `);
  return rows<CandidateRow>(sql`
    select id, name, publisher, source, rss_url as "rssUrl", youtube_channel_id as "youtubeChannelId", language, genre, status,
           found_via as "foundVia", metrics, engagement, relevance, relevance_detail as "relevanceDetail", trend_label as "trendLabel",
           trend_evidence as "trendEvidence", reason, evidence_episodes as "evidenceEpisodes", promoted_podcast_id as "promotedPodcastId",
           first_seen_at as "firstSeenAt", last_evaluated_at as "lastEvaluatedAt"
    from discovery_candidates where status in (${list})
    order by (trend_label = 'trending') desc nulls last, coalesce(relevance, 0) desc, id`);
}

export async function candidateCounts(): Promise<Record<string, number>> {
  const r = await rows<{ status: string; n: number }>(sql`select status, count(*)::int n from discovery_candidates group by status`);
  return Object.fromEntries(r.map((x) => [x.status, Number(x.n)]));
}

// Only shows still under review count toward discovery findings; approved ones now belong to the monitored universe.
const ACTIVE = sql`c.status in ('new', 'saved')`;

type ExtractionRow = { candidateId: number; candidate: string; title: string; url: string | null; at: string; extraction: { guests?: { name: string; role: string; company: string; category: string }[]; topics?: { topic: string; confidence: number }[]; sponsors?: { brand: string; classification: string; evidence: string }[] } };

async function activeExtractions(days: number): Promise<ExtractionRow[]> {
  return rows<ExtractionRow>(sql`
    select c.id as "candidateId", c.name as candidate, e.title, e.url, e.published_at as at, a.raw->'extraction' as extraction
    from discovery_analyses a
    join discovery_episodes e on e.id = a.discovery_episode_id
    join discovery_candidates c on c.id = e.candidate_id
    where ${ACTIVE} and e.published_at > now() - make_interval(days => ${days}::int)`);
}

export type Theme = { theme: string; kind: "topic" | "phrase"; episodes: number; shows: number; recent: number; previous: number; examples: { title: string; url: string | null; candidate: string }[] };

const STOP = new Set("about after again also because before being between both could does doing during each from have here into just like more most much only other over really some such than that their them then there these they this those through very what when where which while with would your you our out how why who the and for are was were will can not but all any one new its get got why".split(" "));

/** Topics and phrases showing up across discovered shows that the founder has not asked for. */
export async function emergingThemes(config: ResearchConfig, limit = 8): Promise<Theme[]> {
  const ex = await activeExtractions(60);
  const now = Date.now();
  const interest = new Set([...config.keywords, ...config.founders, ...config.companies, ...config.products].flatMap((t) => normalize(t).split(" ")));
  type Acc = { theme: string; kind: Theme["kind"]; eps: Set<string>; shows: Set<number>; recent: number; previous: number; examples: Theme["examples"] };
  const acc = new Map<string, Acc>();
  const add = (theme: string, kind: Theme["kind"], r: ExtractionRow) => {
    const a = acc.get(theme) ?? { theme, kind, eps: new Set(), shows: new Set(), recent: 0, previous: 0, examples: [] };
    const id = `${r.candidateId}:${r.title}`;
    if (a.eps.has(id)) return;
    a.eps.add(id);
    a.shows.add(r.candidateId);
    if (now - new Date(r.at).getTime() < 30 * 86_400_000) a.recent++;
    else a.previous++;
    if (a.examples.length < 3) a.examples.push({ title: r.title, url: r.url, candidate: r.candidate });
    acc.set(theme, a);
  };
  for (const r of ex) {
    for (const t of selectTopics(r.extraction.topics ?? [])) if (isUnexpectedTopic(t.topic, config)) add(t.topic, "topic", r);
    const words = normalize(r.title).split(" ").filter((w) => w.length >= 4 && !STOP.has(w) && !interest.has(w));
    for (let i = 0; i < words.length - 1; i++) add(`${words[i]} ${words[i + 1]}`, "phrase", r);
  }
  return [...acc.values()]
    .filter((a) => a.shows.size >= 2 && a.eps.size >= 3)
    .sort((x, y) => y.shows.size - x.shows.size || y.recent - x.recent || y.eps.size - x.eps.size)
    .slice(0, limit)
    .map((a) => ({ theme: a.theme, kind: a.kind, episodes: a.eps.size, shows: a.shows.size, recent: a.recent, previous: a.previous, examples: a.examples }));
}

export type FounderRow = { name: string; company: string | null; role: string | null; shows: string[]; episodes: { title: string; url: string | null; candidate: string }[] };

/** People appearing on discovered shows. `repeaters` appeared on two or more different discovered shows. */
export async function foundersAcrossShows(): Promise<{ repeaters: FounderRow[]; recent: FounderRow[] }> {
  const ex = await activeExtractions(90);
  const map = new Map<string, FounderRow & { ids: Set<number> }>();
  for (const r of ex) {
    for (const g of r.extraction.guests ?? []) {
      if (g.category === "journalist") continue;
      const key = normalize(g.name);
      const row = map.get(key) ?? { name: g.name, company: g.company || null, role: g.role || null, shows: [], episodes: [], ids: new Set<number>() };
      if (!row.ids.has(r.candidateId)) {
        row.ids.add(r.candidateId);
        row.shows.push(r.candidate);
      }
      row.episodes.push({ title: r.title, url: r.url, candidate: r.candidate });
      map.set(key, row);
    }
  }
  const all = [...map.values()].map((r) => ({ name: r.name, company: r.company, role: r.role, shows: r.shows, episodes: r.episodes }));
  return { repeaters: all.filter((p) => p.shows.length >= 2).sort((a, b) => b.shows.length - a.shows.length), recent: all.filter((p) => p.shows.length === 1).slice(0, 8) };
}

export type DiscoverySponsor = { brand: string; classification: string; shows: string[]; quote: string; example: { title: string; url: string | null; candidate: string } };

const STRENGTH: Record<string, number> = { explicit_sponsor: 4, paid_promotion: 3, possible_affiliate: 2, unknown: 1 };

/** Sponsor evidence from discovered shows, with the verified quote. Kept apart from the monitored Sponsor Radar. */
export async function discoverySponsors(limit = 10): Promise<DiscoverySponsor[]> {
  const ex = await activeExtractions(90);
  const map = new Map<string, DiscoverySponsor>();
  for (const r of ex) {
    for (const s of r.extraction.sponsors ?? []) {
      if (!(s.classification in STRENGTH)) continue;
      const key = normalize(s.brand);
      const cur = map.get(key);
      const entry: DiscoverySponsor = cur ?? { brand: s.brand, classification: s.classification, shows: [], quote: s.evidence, example: { title: r.title, url: r.url, candidate: r.candidate } };
      if (!entry.shows.includes(r.candidate)) entry.shows.push(r.candidate);
      if (STRENGTH[s.classification] > STRENGTH[entry.classification]) {
        entry.classification = s.classification;
        entry.quote = s.evidence;
        entry.example = { title: r.title, url: r.url, candidate: r.candidate };
      }
      map.set(key, entry);
    }
  }
  return [...map.values()].sort((a, b) => STRENGTH[b.classification] - STRENGTH[a.classification] || b.shows.length - a.shows.length).slice(0, limit);
}
