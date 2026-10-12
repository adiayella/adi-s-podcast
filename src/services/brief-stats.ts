import { sql } from "drizzle-orm";
import { db } from "@/db";
import { candidateCounts, discoverySponsors, emergingThemes, foundersAcrossShows, listCandidates } from "@/services/discovery-queries";
import { getCoverage } from "@/lib/queries";
import { getFocusContext } from "@/services/focus-context";
import { lastRealRun } from "@/services/job-log";
import { getGuestRadar, getSponsorRadar, getTopicRadar, parsePeriod } from "@/services/radars";

// Everything in the brief that is a fact comes from here: SQL counts and the same scoring code the
// dashboards use. Gemini never produces these numbers; it only comments on them.

type Ep = { title: string; url: string | null; podcast: string; at: string };

export type DiscoveryStats = {
  enabled: boolean;
  universe: string; // says where these numbers come from, so they are never confused with monitored shows
  inQueue: number;
  saved: number;
  lastRunAt: string | null;
  candidates: { name: string; relevance: number; trend: string; reason: string; language: string | null; rssKnown: boolean; episodes: { title: string; url: string | null; at: string }[] }[];
  themes: { theme: string; kind: string; shows: number; episodes: number; recent: number; example: { title: string; url: string | null; candidate: string } | null }[];
  founders: { name: string; role: string | null; company: string | null; shows: string[] }[];
  sponsors: { brand: string; classification: string; shows: string[]; quote: string; example: { title: string; url: string | null; candidate: string } }[];
};

export type FocusSummary = {
  settingsVersion: number;
  universe: string;
  interests: string[];
  categories: string[];
  excludedTopics: string[];
  monitoredPodcasts: number;
  matchedEpisodes: number;
  excludedEpisodes: number;
};

export type BriefStats = {
  // how many monitored episodes were analysed from a transcript; the rest used title and description only
  coverage?: { transcript: number; total: number; shows: number };
  focus?: FocusSummary;
  unexpected?: { name: string; shows: number; episodesThisWeek: number; episodesPrevWeek: number; trend: string; sampleEpisodes: Ep[] }[];
  discovery?: DiscoveryStats;
  weekStart: string;
  generatedAt: string;
  guests: {
    id: number;
    name: string;
    role: string | null;
    company: string | null;
    category: string | null;
    score: number;
    distinctPodcasts: number;
    appearances: number;
    podcasts: string[];
    lastAt: string;
    confidence: number;
    newThisWeek: boolean;
    focus?: boolean;
    episodes: Ep[];
  }[];
  guestEvidence: { windowDays: number; guestsInWindow: number; onMultipleShows: number; sufficient: boolean };
  topics: {
    name: string;
    score: number;
    shows: number;
    podcasts: string[];
    episodesThisWeek: number;
    episodesPrevWeek: number;
    episodes30d: number;
    trend: string;
    scoreChange: number | null;
    focus?: boolean;
    sampleEpisodes: Ep[];
  }[];
  sponsors: {
    name: string;
    category: string | null;
    tier: string;
    disclosedEpisodes: number;
    disclosedShows: number;
    promoEpisodes: number;
    platformFlaggedEpisodes: number;
    score: number;
    podcasts: string[];
    lastAt: string;
    evidenceQuote: string | null;
    evidenceClass: string | null;
    evidenceEpisode: Ep | null;
    focus?: boolean;
  }[];
  sponsorEvidence: { windowDays: number; disclosedBrands: number; promoBrands: number; sufficient: boolean };
  health: { episodesLast7Days: number; syncErrors: number; failedAnalyses: number; lastDailyRun: string | null; lastDailyStatus: string | null };
};

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

const trim = (e: { title: string; url: string | null; podcast: string; at: string }): Ep => ({ title: e.title, url: e.url, podcast: e.podcast, at: e.at });

export async function buildBriefStats(weekStart: string, now = new Date()): Promise<BriefStats> {
  const fx = await getFocusContext(); // the founder's preferences applied to the monitored shows
  const guestWindowDays = Math.min(30, fx.config.dateRangeDays);
  const sponsorWindowDays = Math.min(365, fx.config.dateRangeDays);
  const guestRows = await getGuestRadar({ period: parsePeriod(`${guestWindowDays}d`, now), focus: fx });
  // Prefer people on several shows, then by score; drop journalists (filtered already) and likely staff.
  const candidates = guestRows
    .filter((g) => !g.likelyStaff && !g.needsReview)
    .sort((a, b) => Number(b.focus) - Number(a.focus) || b.distinctPodcasts - a.distinctPodcasts || b.score.score - a.score.score);
  const weekAgo = now.getTime() - 7 * 86_400_000;

  const topicRows = await getTopicRadar({ focus: fx });
  const prev = await rows<{ entityId: number; score: string }>(sql`
    select entity_id as "entityId", score from score_snapshots
    where kind = 'topic' and week_start = (select max(week_start) from score_snapshots where kind = 'topic' and week_start < ${weekStart}::date)`);
  const prevScore = new Map(prev.map((p) => [Number(p.entityId), Number(p.score)]));

  const sponsorRows = await getSponsorRadar({ period: parsePeriod(`${sponsorWindowDays}d`, now), focus: fx });

  const [health] = await rows<{ eps: number; errors: number; failed: number }>(sql`
    select (select count(*) from episodes e join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= now() - interval '7 days')::int as eps,
           (select count(*) from podcasts where enabled and last_sync_status = 'error')::int as errors,
           (select count(*) from analysis_jobs where status = 'failed')::int as failed`);
  const [lastRun] = await rows<{ startedAt: string; status: string }>(sql`
    select started_at as "startedAt", status from job_runs where job = 'focused' order by started_at desc limit 1`);

  const guests = candidates.slice(0, 5).map((g) => ({
    id: g.id,
    name: g.name,
    role: g.role,
    company: g.company,
    category: g.category,
    score: g.score.score,
    distinctPodcasts: g.distinctPodcasts,
    appearances: g.appearances,
    podcasts: g.podcasts,
    lastAt: g.lastAt,
    confidence: Math.round(g.confidence * 100) / 100,
    newThisWeek: new Date(g.firstSeen).getTime() >= weekAgo,
    focus: g.focus,
    episodes: g.episodes.slice(0, 2).map(trim),
  }));

  const topics = topicRows
    .filter((t) => t.distinctPodcasts >= 2)
    .slice(0, 5)
    .map((t) => ({
      name: t.name,
      score: t.score.score,
      shows: t.distinctPodcasts,
      podcasts: t.podcasts,
      episodesThisWeek: t.episodesThisWeek,
      episodesPrevWeek: t.episodesPrevWeek,
      episodes30d: t.episodes30d,
      trend: t.trend,
      scoreChange: prevScore.has(t.id) ? Math.round((t.score.score - prevScore.get(t.id)!) * 10) / 10 : null,
      focus: t.focus,
      sampleEpisodes: t.episodes.slice(0, 3).map(trim),
    }));

  // Topics the founder did not ask for that are rising across several of their monitored shows.
  const unexpected = topicRows
    .filter((t) => t.unexpected && (t.trend === "rising" || t.trend === "new") && t.distinctPodcasts >= 2)
    .slice(0, 3)
    .map((t) => ({ name: t.name, shows: t.distinctPodcasts, episodesThisWeek: t.episodesThisWeek, episodesPrevWeek: t.episodesPrevWeek, trend: t.trend, sampleEpisodes: t.episodes.slice(0, 2).map(trim) }));

  const sponsors = sponsorRows.slice(0, 5).map((s) => {
    const best = s.evidence.find((e) => e.class === "explicit_sponsor" || e.class === "paid_promotion") ?? s.evidence[0];
    return {
      name: s.name,
      category: s.category,
      tier: s.tier,
      disclosedEpisodes: s.confirmedEpisodes,
      disclosedShows: s.confirmedPodcasts,
      promoEpisodes: s.promoEpisodes,
      platformFlaggedEpisodes: s.platformFlaggedEpisodes,
      score: s.score.score,
      podcasts: [...new Set(s.evidence.map((e) => e.podcast))],
      lastAt: s.lastAt,
      evidenceQuote: best?.quote ? best.quote.slice(0, 220) : null,
      evidenceClass: best?.class ?? null,
      evidenceEpisode: best ? trim(best) : null,
      focus: s.focus,
    };
  });

  // Discovery universe: shows outside the watchlist. Read from separate tables, never mixed with the numbers above.
  let discovery: DiscoveryStats;
  if (!fx.config.modes.discovery.enabled) {
    discovery = { enabled: false, universe: "Discovery is switched off", inQueue: 0, saved: 0, lastRunAt: null, candidates: [], themes: [], founders: [], sponsors: [] };
  } else {
    const [cands, counts, themes, founders, dsponsors, lastRun2] = await Promise.all([listCandidates(["new", "saved"]), candidateCounts(), emergingThemes(fx.config, 4), foundersAcrossShows(), discoverySponsors(4), lastRealRun("discovery")]);
    discovery = {
      enabled: true,
      universe: "Podcasts outside your watchlist, found by discovery research and awaiting your review",
      inQueue: counts.new ?? 0,
      saved: counts.saved ?? 0,
      lastRunAt: lastRun2 ? lastRun2.toISOString() : null,
      candidates: cands.slice(0, 5).map((c) => ({ name: c.name, relevance: Math.round(c.relevance ?? 0), trend: c.trendLabel ?? "active", reason: c.reason ?? "", language: c.language, rssKnown: Boolean(c.rssUrl), episodes: (c.evidenceEpisodes ?? []).slice(0, 2) })),
      themes: themes.map((t) => ({ theme: t.theme, kind: t.kind, shows: t.shows, episodes: t.episodes, recent: t.recent, example: t.examples[0] ?? null })),
      founders: founders.repeaters.slice(0, 4).map((f) => ({ name: f.name, role: f.role, company: f.company, shows: f.shows })),
      sponsors: dsponsors.map((d) => ({ brand: d.brand, classification: d.classification, shows: d.shows, quote: d.quote.slice(0, 200), example: d.example })),
    };
  }

  const multi = guestRows.filter((g) => g.distinctPodcasts >= 2).length;
  return {
    weekStart,
    generatedAt: now.toISOString(),
    coverage: await getCoverage(),
    focus: {
      settingsVersion: fx.version,
      universe: `${(await rows<{ n: number }>(sql`select count(*)::int n from podcasts where enabled`))[0]?.n ?? 0} monitored podcasts`,
      interests: [...fx.config.keywords, ...fx.config.founders, ...fx.config.companies, ...fx.config.products].slice(0, 8),
      categories: [...fx.config.categories],
      excludedTopics: [...fx.config.excludedTopics],
      monitoredPodcasts: (await rows<{ n: number }>(sql`select count(*)::int n from podcasts where enabled`))[0]?.n ?? 0,
      matchedEpisodes: fx.matches.size,
      excludedEpisodes: fx.excluded.size,
    },
    unexpected,
    discovery,
    guests,
    guestEvidence: { windowDays: guestWindowDays, guestsInWindow: guestRows.length, onMultipleShows: multi, sufficient: multi >= 1 },
    topics,
    sponsors,
    sponsorEvidence: {
      windowDays: sponsorWindowDays,
      disclosedBrands: sponsorRows.filter((s) => s.confirmedEpisodes > 0).length,
      promoBrands: sponsorRows.filter((s) => s.confirmedEpisodes === 0).length,
      sufficient: sponsorRows.some((s) => s.confirmedEpisodes > 0),
    },
    health: {
      episodesLast7Days: Number(health?.eps ?? 0),
      syncErrors: Number(health?.errors ?? 0),
      failedAnalyses: Number(health?.failed ?? 0),
      lastDailyRun: lastRun?.startedAt ?? null,
      lastDailyStatus: lastRun?.status ?? null,
    },
  };
}
