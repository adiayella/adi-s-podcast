import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSponsorRadar, parsePeriod } from "@/services/radars";
import { getFocusContext } from "@/services/focus-context";
import { getSectorTrends, latestOpportunities } from "@/services/intelligence";

// Everything on the Overview dashboard comes from here, and every figure is read from the database. Where something does not
// exist yet (for example a delta that needs older data than we hold) the field is null and the UI says so.
type Row = Record<string, unknown>;
async function rows<T = Row>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}
const n = (v: unknown) => Number(v ?? 0);

/** Latest public counts per monitored YouTube video: one row per episode. */
const LATEST = sql`
  select s.episode_id, s.external_id as video_id, m.views, m.likes, m.comments
  from episode_sources s join lateral (
    select views, likes, comments from episode_metric_snapshots where episode_source_id = s.id and views is not null order by captured_on desc limit 1
  ) m on true where s.kind = 'youtube'`;

export type Kpi = { key: string; label: string; value: string; spark: number[] | null; delta: { pct: number; label: string } | null; note: string | null };

const compact = (x: number) => (x >= 1e9 ? `${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : String(Math.round(x)));
export { compact };

export async function getOverviewKpis(): Promise<Kpi[]> {
  const [c] = await rows<Row>(sql`
    select (select count(*) from podcasts where enabled)::int podcasts,
           (select count(distinct ga.guest_id) from guest_appearances ga join episodes e on e.id = ga.episode_id join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= now() - interval '90 days')::int guests,
           (select count(*) from analysis_jobs where stage = 'analyze' and status = 'done' and prompt_version = (select max(prompt_version) from analysis_jobs))::int analysed,
           (select count(*) from episodes e join podcasts p on p.id = e.podcast_id and p.enabled)::int episodes,
           (select count(distinct se.brand_id) from sponsor_evidence se join episodes e on e.id = se.episode_id where se.classification in ('explicit_sponsor','paid_promotion') and e.published_at >= now() - interval '90 days')::int sponsors`);
  const [t] = await rows<Row>(sql`select coalesce(sum(l.views),0)::bigint views, coalesce(sum(l.likes),0)::bigint likes, coalesce(sum(l.comments),0)::bigint comments from (${LATEST}) l join episodes e on e.id = l.episode_id join podcasts p on p.id = e.podcast_id and p.enabled`);
  const weekly = await rows<Row>(sql`
    select to_char(date_trunc('week', e.published_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') wk,
           count(distinct e.id)::int eps, count(distinct ga.guest_id)::int guests, coalesce(sum(l.views),0)::bigint views, coalesce(sum(coalesce(l.likes,0)+coalesce(l.comments,0)),0)::bigint eng
    from episodes e join podcasts p on p.id = e.podcast_id and p.enabled
    left join guest_appearances ga on ga.episode_id = e.id
    left join (${LATEST}) l on l.episode_id = e.id
    where e.published_at >= date_trunc('week', now() at time zone 'Asia/Kolkata') - interval '11 weeks'
    group by 1 order by 1`);
  const series = (k: string) => weekly.map((w) => n(w[k]));
  const delta = (arr: number[]) => (arr.length >= 3 && arr[arr.length - 3] > 0 ? { pct: ((arr[arr.length - 2] - arr[arr.length - 3]) / arr[arr.length - 3]) * 100, label: "last full week vs the one before" } : null);
  const eps = series("eps");
  return [
    { key: "podcasts", label: "Podcasts monitored", value: String(n(c.podcasts)), spark: null, delta: null, note: "your watchlist" },
    { key: "guests", label: "Unique guests (90d)", value: String(n(c.guests)), spark: series("guests"), delta: delta(series("guests")), note: null },
    { key: "episodes", label: "Episodes analysed", value: `${n(c.analysed)}`, spark: eps, delta: delta(eps), note: `of ${n(c.episodes)} stored` },
    { key: "views", label: "Total views", value: compact(n(t.views)), spark: series("views"), delta: null, note: "public YouTube counts, by publish week" },
    { key: "eng", label: "Likes + comments", value: compact(n(t.likes) + n(t.comments)), spark: series("eng"), delta: null, note: "shares are not available" },
    { key: "sponsors", label: "Disclosed sponsors (90d)", value: String(n(c.sponsors)), spark: null, delta: null, note: "verified disclosures only" },
  ];
}

// ---------------------------------------------------------------- topic convergence heatmap
export type Heat = { topics: string[]; cells: { a: number; b: number; episodes: number; guests: number; sponsors: number }[]; max: number };

/** Which topics are discussed together: for every pair, the episodes tagged with both (diagonal = the topic's own episodes). */
export async function getConvergenceHeatmap(days = 90): Promise<Heat> {
  const top = await rows<{ id: number; name: string }>(sql`
    select t.id, t.name from episode_topics et join topics t on t.id = et.topic_id join episodes e on e.id = et.episode_id join podcasts p on p.id = e.podcast_id and p.enabled
    where e.published_at >= now() - make_interval(days => ${days}) group by 1, 2 order by count(distinct e.id) desc limit 10`);
  if (!top.length) return { topics: [], cells: [], max: 0 };
  const ids = sql.join(top.map((t) => sql`${t.id}`), sql`, `);
  const pairs = await rows<Row>(sql`
    with ep as (select et.episode_id, et.topic_id from episode_topics et join episodes e on e.id = et.episode_id join podcasts p on p.id = e.podcast_id and p.enabled
                where e.published_at >= now() - make_interval(days => ${days}) and et.topic_id in (${ids}))
    select a.topic_id a, b.topic_id b, count(distinct a.episode_id)::int episodes,
           (select count(distinct ga.guest_id) from guest_appearances ga where ga.episode_id in (select a2.episode_id from ep a2 join ep b2 on b2.episode_id = a2.episode_id where a2.topic_id = a.topic_id and b2.topic_id = b.topic_id))::int guests,
           (select count(distinct se.brand_id) from sponsor_evidence se where se.classification in ('explicit_sponsor','paid_promotion') and se.episode_id in (select a2.episode_id from ep a2 join ep b2 on b2.episode_id = a2.episode_id where a2.topic_id = a.topic_id and b2.topic_id = b.topic_id))::int sponsors
    from ep a join ep b on b.episode_id = a.episode_id group by a.topic_id, b.topic_id`);
  const idx = new Map(top.map((t, i) => [Number(t.id), i]));
  const cells = pairs.map((p) => ({ a: idx.get(n(p.a))!, b: idx.get(n(p.b))!, episodes: n(p.episodes), guests: n(p.guests), sponsors: n(p.sponsors) }));
  return { topics: top.map((t) => t.name), cells, max: Math.max(1, ...cells.filter((c) => c.a !== c.b).map((c) => c.episodes)) };
}

// ---------------------------------------------------------------- guest media-round timeline
export type TimelineItem = { guestId: number; name: string; photo: string | null; role: string | null; company: string | null; episode: string; podcast: string; at: string; url: string | null; videoId: string | null; views: number | null; minutes: number | null };

export async function getGuestTimeline(limit = 6): Promise<TimelineItem[]> {
  const r = await rows<Row>(sql`
    select * from (
      select distinct on (g.id) g.id gid, g.canonical_name name, g.photo_url photo, g.role, g.company, e.title, p.name podcast, e.published_at at, e.url, e.duration_seconds dur,
             (select s.external_id from episode_sources s where s.episode_id = e.id and s.kind = 'youtube' limit 1) vid, l.views
      from guest_appearances ga join guests g on g.id = ga.guest_id join episodes e on e.id = ga.episode_id join podcasts p on p.id = e.podcast_id and p.enabled
      left join (${LATEST}) l on l.episode_id = e.id
      where g.needs_review = false and ga.confidence >= 0.7 and coalesce(g.category, '') <> 'journalist'
      order by g.id, e.published_at desc) x
    order by at desc limit ${limit}`);
  return r.map((x) => ({ guestId: n(x.gid), name: String(x.name), photo: (x.photo as string) ?? null, role: (x.role as string) ?? null, company: (x.company as string) ?? null, episode: String(x.title), podcast: String(x.podcast), at: String(x.at), url: (x.url as string) ?? null, videoId: (x.vid as string) ?? null, views: x.views === null || x.views === undefined ? null : n(x.views), minutes: x.dur ? Math.round(n(x.dur) / 60) : null }));
}

// ---------------------------------------------------------------- sponsors
export type SponsorLine = { name: string; category: string | null; shows: number; episodes: number; kind: "disclosed" | "promo"; lastAt: string; tier: string };
export async function getSponsorTable(limit = 8): Promise<SponsorLine[]> {
  const fx = await getFocusContext();
  const list = await getSponsorRadar({ period: parsePeriod("90d"), focus: fx });
  return list.slice(0, limit).map((s) => ({ name: s.name, category: s.category, shows: s.distinctPodcasts, episodes: s.totalEpisodes, kind: s.confirmedEpisodes > 0 ? "disclosed" : "promo", lastAt: s.lastAt, tier: s.tier }));
}

// ---------------------------------------------------------------- sector explorer
export type SectorSeries = { weeks: string[]; topics: { name: string; episodes: number[]; views: number[] }[] };
export async function getSectorSeries(weeks = 12, top = 5): Promise<SectorSeries> {
  const r = await rows<Row>(sql`
    select to_char(date_trunc('week', e.published_at at time zone 'Asia/Kolkata'), 'DD Mon') wk, date_trunc('week', e.published_at at time zone 'Asia/Kolkata') wd, t.name, count(distinct e.id)::int eps, coalesce(sum(l.views),0)::bigint views
    from episode_topics et join topics t on t.id = et.topic_id join episodes e on e.id = et.episode_id join podcasts p on p.id = e.podcast_id and p.enabled
    left join (${LATEST}) l on l.episode_id = e.id
    where e.published_at >= date_trunc('week', now() at time zone 'Asia/Kolkata') - make_interval(weeks => ${weeks - 1})
    group by 1, 2, 3 order by 2`);
  const labels = [...new Map(r.map((x) => [String(x.wk), n(new Date(String(x.wd)).getTime())])).entries()].sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  const total = new Map<string, number>();
  for (const x of r) total.set(String(x.name), (total.get(String(x.name)) ?? 0) + n(x.eps));
  const names = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map((x) => x[0]);
  return { weeks: labels, topics: names.map((name) => ({ name, episodes: labels.map((w) => n(r.find((x) => String(x.name) === name && String(x.wk) === w)?.eps)), views: labels.map((w) => n(r.find((x) => String(x.name) === name && String(x.wk) === w)?.views)) })) };
}

// ---------------------------------------------------------------- engagement
export type EngagementData = { views: number; likes: number; comments: number; weekly: { label: string; views: number; likes: number; comments: number }[] };
export async function getEngagement(): Promise<EngagementData> {
  const weekly = await rows<Row>(sql`
    select to_char(date_trunc('week', e.published_at at time zone 'Asia/Kolkata'), 'DD Mon') label, date_trunc('week', e.published_at at time zone 'Asia/Kolkata') wd,
           coalesce(sum(l.views),0)::bigint views, coalesce(sum(l.likes),0)::bigint likes, coalesce(sum(l.comments),0)::bigint comments
    from episodes e join podcasts p on p.id = e.podcast_id and p.enabled join (${LATEST}) l on l.episode_id = e.id
    where e.published_at >= now() - interval '90 days' group by 1, 2 order by 2`);
  const w = weekly.map((x) => ({ label: String(x.label), views: n(x.views), likes: n(x.likes), comments: n(x.comments) }));
  return { views: w.reduce((a, x) => a + x.views, 0), likes: w.reduce((a, x) => a + x.likes, 0), comments: w.reduce((a, x) => a + x.comments, 0), weekly: w };
}

// ---------------------------------------------------------------- evidence review
export type EvidenceItem = { title: string; level: "high" | "medium" | "low"; line: string; source: string; url: string | null };
export type EvidenceReview = { insights: EvidenceItem[]; quotes: EvidenceItem[] };
export async function getEvidenceReview(): Promise<EvidenceReview> {
  const sectors = (await getSectorTrends()).filter((s) => s.episodesThisWeek + s.episodesPrevWeek > 0).sort((a, b) => b.confidence.score - a.confidence.score || b.shows - a.shows).slice(0, 4);
  const insights: EvidenceItem[] = [];
  for (const s of sectors) {
    const [ex] = await rows<Row>(sql`select e.title, p.name podcast, e.published_at at, e.url from episode_topics et join topics t on t.id = et.topic_id join episodes e on e.id = et.episode_id join podcasts p on p.id = e.podcast_id and p.enabled where t.name = ${s.name} order by e.published_at desc limit 1`);
    insights.push({ title: `${s.name}: ${s.trend === "rising" || s.trend === "new" ? "gaining ground" : s.trend === "falling" ? "cooling" : "steady"}`, level: s.confidence.level, line: `${s.episodesThisWeek} episodes this week vs ${s.episodesPrevWeek} before, across ${s.shows} shows. ${s.confidence.reasons.join("; ")}.`, source: ex ? `${ex.podcast}: ${ex.title}` : "", url: (ex?.url as string) ?? null });
  }
  const q = await rows<Row>(sql`
    select * from (
      select se.evidence_quote quote, se.confidence, b.canonical_name who, p.name podcast, e.title, e.url, e.published_at at, 'sponsor' kind from sponsor_evidence se join brands b on b.id = se.brand_id join episodes e on e.id = se.episode_id join podcasts p on p.id = e.podcast_id and p.enabled where se.evidence_quote is not null and se.classification in ('explicit_sponsor','paid_promotion')
      union all
      select ga.evidence_text, ga.confidence, g.canonical_name, p.name, e.title, e.url, e.published_at, 'guest' from guest_appearances ga join guests g on g.id = ga.guest_id join episodes e on e.id = ga.episode_id join podcasts p on p.id = e.podcast_id and p.enabled where ga.evidence_text is not null and g.needs_review = false
    ) z order by confidence desc, at desc limit 4`);
  const quotes: EvidenceItem[] = q.map((x) => ({ title: `${x.who} (${x.kind})`, level: n(x.confidence) >= 0.85 ? "high" : n(x.confidence) >= 0.65 ? "medium" : "low", line: `“${String(x.quote).slice(0, 220)}”`, source: `${x.podcast}: ${x.title}`, url: (x.url as string) ?? null }));
  return { insights, quotes };
}

// ---------------------------------------------------------------- outreach recommendations
export type Reco = { id: number; name: string; photo: string | null; role: string | null; company: string | null; score: number; level: string; tags: string[] };
export async function getRecommendations(limit = 5): Promise<Reco[]> {
  const top = await latestOpportunities("guest", limit);
  const out: Reco[] = [];
  for (const o of top) {
    const [g] = await rows<Row>(sql`select photo_url, role, company from guests where id = ${o.entity_id}`);
    const tags = await rows<{ name: string }>(sql`select t.name from guest_appearances ga join episode_topics et on et.episode_id = ga.episode_id join topics t on t.id = et.topic_id where ga.guest_id = ${o.entity_id} group by t.name order by count(*) desc limit 3`);
    out.push({ id: o.entity_id, name: o.name, photo: (g?.photo_url as string) ?? null, role: (g?.role as string) ?? null, company: (g?.company as string) ?? o.company, score: Number(o.score), level: o.confidence.level, tags: tags.map((t) => t.name) });
  }
  return out;
}

// ---------------------------------------------------------------- search
export type SearchResults = { guests: { id: number; name: string; role: string | null; company: string | null; photo: string | null }[]; podcasts: { id: number; name: string }[]; topics: { name: string; episodes: number }[]; brands: { id: number; name: string; category: string | null }[]; episodes: { title: string; podcast: string; at: string; url: string | null }[] };
export async function searchAll(q: string): Promise<SearchResults> {
  const like = `%${q.replace(/[%_\\]/g, " ").trim()}%`;
  const [guests, podcasts, topics, brands, episodes] = await Promise.all([
    rows<Row>(sql`select id, canonical_name name, role, company, photo_url photo from guests where (canonical_name ilike ${like} or company ilike ${like}) and needs_review = false order by canonical_name limit 8`),
    rows<Row>(sql`select id, name from podcasts where name ilike ${like} order by name limit 8`),
    rows<Row>(sql`select t.name, count(et.episode_id)::int episodes from topics t left join episode_topics et on et.topic_id = t.id where t.name ilike ${like} group by t.name order by 2 desc limit 8`),
    rows<Row>(sql`select id, canonical_name name, category from brands where canonical_name ilike ${like} and needs_review = false order by canonical_name limit 8`),
    rows<Row>(sql`select e.title, p.name podcast, e.published_at at, e.url from episodes e join podcasts p on p.id = e.podcast_id where e.title ilike ${like} order by e.published_at desc limit 8`),
  ]);
  return {
    guests: guests.map((g) => ({ id: n(g.id), name: String(g.name), role: (g.role as string) ?? null, company: (g.company as string) ?? null, photo: (g.photo as string) ?? null })),
    podcasts: podcasts.map((p) => ({ id: n(p.id), name: String(p.name) })),
    topics: topics.map((t) => ({ name: String(t.name), episodes: n(t.episodes) })),
    brands: brands.map((b) => ({ id: n(b.id), name: String(b.name), category: (b.category as string) ?? null })),
    episodes: episodes.map((e) => ({ title: String(e.title), podcast: String(e.podcast), at: String(e.at), url: (e.url as string) ?? null })),
  };
}
