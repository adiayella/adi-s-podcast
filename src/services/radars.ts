import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DEFAULT_WEIGHTS, type RadarKind } from "@/lib/scoring-config";
import {
  guestScore,
  outreachTier,
  sponsorScore,
  topicScore,
  type OutreachTier,
  type ScoreResult,
  type Weights,
} from "@/scoring/formulas";

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

const DAY = 86_400_000;
const daysBetween = (later: Date, earlier: Date | string | null) => (earlier ? Math.max(0, (later.getTime() - new Date(earlier).getTime()) / DAY) : null);

/** Weights come from the settings table (key "weights") so they can be tuned without a deploy. */
export async function getWeights(kind: RadarKind): Promise<Weights> {
  const defaults = Object.fromEntries(DEFAULT_WEIGHTS[kind].map((w) => [w.key, w.weight])) as Weights;
  const [row] = await rows<{ value: Record<string, Weights> }>(sql`select value from settings where key = 'weights'`);
  return { ...defaults, ...(row?.value?.[kind] ?? {}) };
}

// ---------------------------------------------------------------- periods
export type Period = { key: string; label: string; start: Date; end: Date; calendarMonth: boolean };

/** "2026-09" = that calendar month in IST; "30d"/"90d" = rolling window ending now. */
export function parsePeriod(raw: string | string[] | undefined, now = new Date()): Period {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const m = v ? /^(\d{4})-(\d{2})$/.exec(v) : null;
  if (m) {
    const start = new Date(`${m[1]}-${m[2]}-01T00:00:00+05:30`);
    const next = new Date(Date.UTC(Number(m[1]), Number(m[2]), 1));
    const end = new Date(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00+05:30`);
    const label = start.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
    return { key: `${m[1]}-${m[2]}`, label, start, end: end > now ? new Date(now.getTime() + 1000) : end, calendarMonth: true };
  }
  const n = v === "30d" ? 30 : v === "7d" ? 7 : 90;
  return { key: `${n}d`, label: `Last ${n} days`, start: new Date(now.getTime() - n * DAY), end: new Date(now.getTime() + 1000), calendarMonth: false };
}

export async function getMonthsWithData(): Promise<string[]> {
  const res = await rows<{ ym: string }>(sql`
    select distinct to_char(e.published_at at time zone 'Asia/Kolkata', 'YYYY-MM') as ym
    from episodes e join podcasts p on p.id = e.podcast_id and p.enabled order by ym desc`);
  return res.map((r) => r.ym);
}

export async function getEnabledPodcasts(): Promise<{ id: number; name: string }[]> {
  return rows(sql`select id, name from podcasts where enabled order by name`);
}

// ---------------------------------------------------------------- guests
export type EpisodeRef = { title: string; url: string | null; podcast: string; at: string; evidence?: string | null };

export type GuestRow = {
  id: number;
  name: string;
  company: string | null;
  role: string | null;
  category: string | null;
  needsReview: boolean;
  appearances: number;
  rawAppearances: number;
  distinctPodcasts: number;
  podcasts: string[];
  lastAt: string;
  firstSeen: string;
  confidence: number;
  episodes: EpisodeRef[];
  score: ScoreResult;
  rank: number;
  newFace: boolean;
  repeatThisMonth: boolean;
  likelyStaff: boolean;
};

export async function getGuestRadar(opts: { period: Period; podcastId?: number; includeJournalists?: boolean }): Promise<GuestRow[]> {
  const { period, podcastId, includeJournalists } = opts;
  const start = period.start.toISOString();
  const end = period.end.toISOString();
  const podcastFilter = podcastId ? sql`and e.podcast_id = ${podcastId}` : sql``;
  const res = await rows<Record<string, unknown>>(sql`
    with apps as (
      select ga.guest_id, e.podcast_id, p.name as podcast, e.title, e.url, e.published_at, ga.confidence, ga.evidence_text,
             lag(e.published_at) over (partition by ga.guest_id, e.podcast_id order by e.published_at) as prev
      from guest_appearances ga
      join episodes e on e.id = ga.episode_id
      join podcasts p on p.id = e.podcast_id and p.enabled
      where e.published_at >= ${start}::timestamptz and e.published_at < ${end}::timestamptz ${podcastFilter}
    ), kept as (
      -- the same guest on the same show within 7 days is one appearance (re-uploads, trailers)
      select * from apps where prev is null or published_at - prev >= interval '7 days'
    )
    select g.id, g.canonical_name as name, g.company, g.role, g.category, g.needs_review as "needsReview",
           count(*)::int as appearances,
           (select count(*)::int from apps a where a.guest_id = g.id) as "rawAppearances",
           count(distinct k.podcast_id)::int as "distinctPodcasts",
           array_agg(distinct k.podcast) as podcasts,
           max(k.published_at) as "lastAt",
           (select min(e2.published_at) from guest_appearances ga2 join episodes e2 on e2.id = ga2.episode_id where ga2.guest_id = g.id) as "firstSeen",
           avg(k.confidence)::float as confidence,
           json_agg(json_build_object('title', k.title, 'url', k.url, 'podcast', k.podcast, 'at', k.published_at, 'evidence', k.evidence_text)
                    order by k.published_at desc) as episodes
    from kept k join guests g on g.id = k.guest_id
    where ${includeJournalists ? sql`true` : sql`coalesce(g.category, '') <> 'journalist'`}
    group by g.id`);

  const weights = await getWeights("guest");
  const asOf = period.end;
  const now = new Date();
  const out: GuestRow[] = res.map((r) => {
    const lastAt = r.lastAt as string;
    const score = guestScore(
      {
        distinctPodcasts: Number(r.distinctPodcasts),
        appearances: Number(r.appearances),
        daysSinceLast: daysBetween(asOf < now ? asOf : now, lastAt),
        confidence: (r.confidence as number) ?? null,
      },
      weights,
    );
    return {
      id: Number(r.id),
      name: r.name as string,
      company: r.company as string | null,
      role: r.role as string | null,
      category: r.category as string | null,
      needsReview: Boolean(r.needsReview),
      appearances: Number(r.appearances),
      rawAppearances: Number(r.rawAppearances),
      distinctPodcasts: Number(r.distinctPodcasts),
      podcasts: r.podcasts as string[],
      lastAt,
      firstSeen: r.firstSeen as string,
      confidence: Number(r.confidence ?? 0),
      episodes: r.episodes as EpisodeRef[],
      score,
      rank: 0,
      // first seen in the last 30 days of our 90-day data; a window-relative flag would mark everyone as new
      newFace: new Date(r.firstSeen as string).getTime() >= now.getTime() - 30 * DAY,
      repeatThisMonth: period.calendarMonth && Number(r.distinctPodcasts) >= 2,
      // appears again and again on one show only: more likely a regular contributor than a bookable guest
      likelyStaff: Number(r.appearances) >= 4 && Number(r.distinctPodcasts) === 1,
    };
  });
  out.sort((a, b) => b.score.score - a.score.score || new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime() || a.name.localeCompare(b.name));
  out.forEach((g, i) => (g.rank = i + 1));
  return out;
}

// ---------------------------------------------------------------- topics
export type TopicRow = {
  id: number;
  name: string;
  episodes30d: number;
  episodesThisWeek: number;
  episodesPrevWeek: number;
  episodesThisMonth: number;
  distinctPodcasts: number;
  podcasts: string[];
  lastAt: string;
  confidence: number;
  weekly: { week: string; n: number }[];
  episodes: EpisodeRef[];
  score: ScoreResult;
  rank: number;
  momentumPct: number | null;
  trend: "rising" | "steady" | "falling" | "new";
};

export async function getTopicRadar(opts: { podcastId?: number } = {}): Promise<TopicRow[]> {
  const podcastFilter = opts.podcastId ? sql`and e.podcast_id = ${opts.podcastId}` : sql``;
  const base = await rows<Record<string, unknown>>(sql`
    select tp.id, tp.name,
      count(distinct e.id) filter (where e.published_at >= now() - interval '30 days')::int as "episodes30d",
      count(distinct e.id) filter (where e.published_at >= now() - interval '7 days')::int as "episodesThisWeek",
      count(distinct e.id) filter (where e.published_at >= now() - interval '14 days' and e.published_at < now() - interval '7 days')::int as "episodesPrevWeek",
      count(distinct e.id) filter (where date_trunc('month', e.published_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata'))::int as "episodesThisMonth",
      count(distinct e.podcast_id) filter (where e.published_at >= now() - interval '30 days')::int as "distinctPodcasts",
      array_agg(distinct p.name) filter (where e.published_at >= now() - interval '30 days') as podcasts,
      max(e.published_at) as "lastAt",
      (avg(et.confidence) filter (where e.published_at >= now() - interval '30 days'))::float as confidence
    from episode_topics et
    join topics tp on tp.id = et.topic_id
    join episodes e on e.id = et.episode_id
    join podcasts p on p.id = e.podcast_id and p.enabled
    where e.published_at >= now() - interval '60 days' ${podcastFilter}
    group by tp.id, tp.name`);

  const weekly = await rows<{ topicId: number; week: string; n: number }>(sql`
    select et.topic_id as "topicId", to_char(date_trunc('week', e.published_at at time zone 'Asia/Kolkata'), 'DD Mon') as week,
           date_trunc('week', e.published_at at time zone 'Asia/Kolkata') as wk, count(distinct e.id)::int as n
    from episode_topics et join episodes e on e.id = et.episode_id join podcasts p on p.id = e.podcast_id and p.enabled
    where e.published_at >= date_trunc('week', now() at time zone 'Asia/Kolkata') - interval '7 weeks' ${podcastFilter}
    group by 1, 2, wk order by wk`);

  const eps = await rows<{ topicId: number } & EpisodeRef>(sql`
    select * from (
      select et.topic_id as "topicId", e.title, e.url, p.name as podcast, e.published_at as at,
             row_number() over (partition by et.topic_id order by e.published_at desc) rn
      from episode_topics et join episodes e on e.id = et.episode_id join podcasts p on p.id = e.podcast_id and p.enabled
      where e.published_at >= now() - interval '30 days' ${podcastFilter}
    ) t where rn <= 6`);

  const weights = await getWeights("topic");
  const now = new Date();
  const out: TopicRow[] = base
    .filter((r) => Number(r.episodes30d) > 0)
    .map((r) => {
      const thisWeek = Number(r.episodesThisWeek);
      const prev = Number(r.episodesPrevWeek);
      const score = topicScore(
        { distinctPodcasts: Number(r.distinctPodcasts), episodesThisWeek: thisWeek, episodesPrevWeek: prev, daysSinceLast: daysBetween(now, r.lastAt as string), confidence: (r.confidence as number) ?? null },
        weights,
      );
      return {
        id: Number(r.id),
        name: r.name as string,
        episodes30d: Number(r.episodes30d),
        episodesThisWeek: thisWeek,
        episodesPrevWeek: prev,
        episodesThisMonth: Number(r.episodesThisMonth),
        distinctPodcasts: Number(r.distinctPodcasts),
        podcasts: (r.podcasts as string[]) ?? [],
        lastAt: r.lastAt as string,
        confidence: Number(r.confidence ?? 0),
        weekly: weekly.filter((w) => Number(w.topicId) === Number(r.id)).map((w) => ({ week: w.week, n: Number(w.n) })),
        episodes: eps.filter((e) => Number(e.topicId) === Number(r.id)),
        score,
        rank: 0,
        momentumPct: prev === 0 ? null : ((thisWeek - prev) / prev) * 100,
        trend: prev === 0 && thisWeek > 0 ? "new" : thisWeek > prev ? "rising" : thisWeek < prev ? "falling" : "steady",
      } satisfies TopicRow;
    });
  out.sort((a, b) => b.score.score - a.score.score || b.distinctPodcasts - a.distinctPodcasts || a.name.localeCompare(b.name));
  out.forEach((t, i) => (t.rank = i + 1));
  return out;
}

// ---------------------------------------------------------------- sponsors
export type SponsorEvidenceRow = { podcast: string; title: string; url: string | null; at: string; class: string; quote: string | null; flag: boolean; confidence: number };

export type SponsorRow = {
  id: number;
  name: string;
  category: string | null;
  confirmedEpisodes: number;
  confirmedPodcasts: number;
  promoEpisodes: number; // unverified promotional mentions (link/code/unclear)
  totalEpisodes: number;
  distinctPodcasts: number;
  platformFlaggedEpisodes: number;
  lastAt: string;
  lastConfirmedAt: string | null;
  evidence: SponsorEvidenceRow[];
  score: ScoreResult; // disclosed sponsorships only
  signal: ScoreResult; // everything promotional, shown separately and labelled unverified
  tier: OutreachTier;
  rank: number;
};

export async function getSponsorRadar(opts: { period: Period; podcastId?: number }): Promise<SponsorRow[]> {
  const start = opts.period.start.toISOString();
  const end = opts.period.end.toISOString();
  const podcastFilter = opts.podcastId ? sql`and e.podcast_id = ${opts.podcastId}` : sql``;
  const CONF = sql`se.classification in ('explicit_sponsor', 'paid_promotion')`;
  const res = await rows<Record<string, unknown>>(sql`
    select b.id, b.canonical_name as name, b.category,
      count(*)::int as "totalEpisodes",
      count(*) filter (where ${CONF})::int as "confirmedEpisodes",
      count(distinct e.podcast_id) filter (where ${CONF})::int as "confirmedPodcasts",
      count(*) filter (where not (${CONF}))::int as "promoEpisodes",
      count(distinct e.podcast_id)::int as "distinctPodcasts",
      count(*) filter (where se.platform_paid_flag)::int as "platformFlaggedEpisodes",
      max(e.published_at) as "lastAt",
      max(e.published_at) filter (where ${CONF}) as "lastConfirmedAt",
      (avg(se.confidence) filter (where ${CONF}))::float as "confConfirmed",
      avg(se.confidence)::float as "confAll",
      json_agg(json_build_object('podcast', p.name, 'title', e.title, 'url', e.url, 'at', e.published_at,
               'class', se.classification, 'quote', se.evidence_quote, 'flag', se.platform_paid_flag, 'confidence', se.confidence)
               order by e.published_at desc) as evidence
    from sponsor_evidence se
    join brands b on b.id = se.brand_id
    join episodes e on e.id = se.episode_id
    join podcasts p on p.id = e.podcast_id and p.enabled
    where e.published_at >= ${start}::timestamptz and e.published_at < ${end}::timestamptz ${podcastFilter}
    group by b.id`);

  const weights = await getWeights("sponsor");
  const now = new Date();
  const out: SponsorRow[] = res.map((r) => {
    const confirmedEpisodes = Number(r.confirmedEpisodes);
    const score = sponsorScore(
      { confirmedOccurrences: confirmedEpisodes, distinctConfirmedPodcasts: Number(r.confirmedPodcasts), daysSinceLastConfirmed: daysBetween(now, r.lastConfirmedAt as string | null), confidence: (r.confConfirmed as number) ?? null },
      weights,
    );
    const signal = sponsorScore(
      { confirmedOccurrences: Number(r.totalEpisodes), distinctConfirmedPodcasts: Number(r.distinctPodcasts), daysSinceLastConfirmed: daysBetween(now, r.lastAt as string), confidence: (r.confAll as number) ?? null },
      weights,
    );
    return {
      id: Number(r.id),
      name: r.name as string,
      category: r.category as string | null,
      confirmedEpisodes,
      confirmedPodcasts: Number(r.confirmedPodcasts),
      promoEpisodes: Number(r.promoEpisodes),
      totalEpisodes: Number(r.totalEpisodes),
      distinctPodcasts: Number(r.distinctPodcasts),
      platformFlaggedEpisodes: Number(r.platformFlaggedEpisodes),
      lastAt: r.lastAt as string,
      lastConfirmedAt: (r.lastConfirmedAt as string | null) ?? null,
      evidence: r.evidence as SponsorEvidenceRow[],
      score,
      signal,
      tier: outreachTier({ confirmedPodcasts: Number(r.confirmedPodcasts), confirmedEpisodes, platformFlaggedEpisodes: Number(r.platformFlaggedEpisodes), promoEpisodes: Number(r.promoEpisodes) }),
      rank: 0,
    };
  });
  out.sort((a, b) => a.tier.localeCompare(b.tier) || b.score.score - a.score.score || b.signal.score - a.signal.score || a.name.localeCompare(b.name));
  out.forEach((s, i) => (s.rank = i + 1));
  return out;
}
