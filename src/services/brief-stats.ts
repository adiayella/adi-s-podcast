import { sql } from "drizzle-orm";
import { db } from "@/db";
import { candidateCounts, discoverySponsors, emergingThemes, foundersAcrossShows, listCandidates } from "@/services/discovery-queries";
import { getCoverage } from "@/lib/queries";
import { getFocusContext } from "@/services/focus-context";
import { lastRealRun } from "@/services/job-log";
import { addDays, weekLabel, weekRange } from "@/lib/weeks";
import { getSectorTrends } from "@/services/intelligence";
import { topAudienceThemes } from "@/services/audience";
import { listTargets } from "@/services/outreach";
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

export type SectorBrief = { name: string; episodesThisWeek: number; episodesPrevWeek: number; trend: string; perfIndex: number | null; per1k: number | null; viewsGained7d: number | null; confidence: string; focus: boolean };
export type AudienceBrief = { kind: string; label: string; support: number; videos: number; quote: string | null; interviewQuestion: string | null };
export type OutreachBrief = {
  kind: "guest" | "brand";
  name: string;
  company: string | null;
  score: number;
  why: string[];
  evidence: { title: string; podcast: string; date: string; url: string | null }[];
  contacts: { kind: string; value: string; verified: boolean }[];
  subject: string | null;
  body: string | null;
  status: string | null; // draft | approved | null when no draft exists
};
export type ActionPlan = { guest: { name: string; reason: string } | null; topic: { name: string; reason: string } | null; sponsor: { name: string; reason: string } | null; sponsorNote: string | null };

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
  // the reported Monday-to-Sunday IST week and the one before it, with real counts for both
  period?: { label: string; from: string; to: string; previousLabel: string };
  sectors?: SectorBrief[];
  audience?: AudienceBrief[];
  outreach?: OutreachBrief[];
  plan?: ActionPlan;
  dataNotes?: string[]; // set when the brief had to be written from data that was not fully fresh or analysed
  activity?: { episodes: number; previousEpisodes: number; shows: number; previousShows: number; newGuests: number; previousNewGuests: number };
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

export async function buildBriefStats(weekStart: string, generatedAt = new Date()): Promise<BriefStats> {
  // Everything is measured as of the END of the reported week, so a brief regenerated later still describes that week.
  const range = weekRange(weekStart);
  const prevRange = weekRange(addDays(weekStart, -7));
  const now = new Date(Math.min(range.to.getTime(), generatedAt.getTime()));
  const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
  const fx = await getFocusContext(); // the founder's preferences applied to the monitored shows
  const guestWindowDays = Math.min(30, fx.config.dateRangeDays);
  const sponsorWindowDays = Math.min(365, fx.config.dateRangeDays);
  const guestRows = await getGuestRadar({ period: parsePeriod(`${guestWindowDays}d`, now), focus: fx });
  // Prefer people on several shows, then by score; drop journalists (filtered already) and likely staff.
  const candidates = guestRows
    .filter((g) => !g.likelyStaff && !g.needsReview)
    .sort((a, b) => Number(b.focus) - Number(a.focus) || b.distinctPodcasts - a.distinctPodcasts || b.score.score - a.score.score);
  const weekAgo = now.getTime() - 7 * 86_400_000;

  const topicRows = await getTopicRadar({ focus: fx, asOf: now });
  const prev = await rows<{ entityId: number; score: string }>(sql`
    select entity_id as "entityId", score from score_snapshots
    where kind = 'topic' and week_start = (select max(week_start) from score_snapshots where kind = 'topic' and week_start < ${weekStart}::date)`);
  const prevScore = new Map(prev.map((p) => [Number(p.entityId), Number(p.score)]));

  const sponsorRows = await getSponsorRadar({ period: parsePeriod(`${sponsorWindowDays}d`, now), focus: fx });

  const [health] = await rows<{ eps: number; errors: number; failed: number }>(sql`
    select (select count(*) from episodes e join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= ${ts(range.from)} and e.published_at < ${ts(now)})::int as eps,
           (select count(*) from podcasts where enabled and last_sync_status = 'error')::int as errors,
           (select count(*) from analysis_jobs where status = 'failed')::int as failed`);
  const [lastRun] = await rows<{ startedAt: string; status: string }>(sql`
    select started_at as "startedAt", status from job_runs where job = 'focused' order by started_at desc limit 1`);

  const [act] = await rows<{ eps: number; prevEps: number; shows: number; prevShows: number; newG: number; prevNewG: number }>(sql`
    with first_seen as (
      select ga.guest_id, min(e2.published_at) as at from guest_appearances ga join episodes e2 on e2.id = ga.episode_id group by 1
    )
    select
      (select count(*) from episodes e join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= ${ts(range.from)} and e.published_at < ${ts(range.to)})::int as eps,
      (select count(*) from episodes e join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= ${ts(prevRange.from)} and e.published_at < ${ts(prevRange.to)})::int as "prevEps",
      (select count(distinct e.podcast_id) from episodes e join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= ${ts(range.from)} and e.published_at < ${ts(range.to)})::int as shows,
      (select count(distinct e.podcast_id) from episodes e join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= ${ts(prevRange.from)} and e.published_at < ${ts(prevRange.to)})::int as "prevShows",
      (select count(*) from first_seen where at >= ${ts(range.from)} and at < ${ts(range.to)})::int as "newG",
      (select count(*) from first_seen where at >= ${ts(prevRange.from)} and at < ${ts(prevRange.to)})::int as "prevNewG"`);

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

  // Sector intelligence: topic momentum and engagement, measured as of the end of the reported week.
  const sectorRows = (await getSectorTrends({ asOf: now })).filter((x) => x.episodesThisWeek + x.episodesPrevWeek > 0);
  const sectors: SectorBrief[] = sectorRows
    .sort((a, b) => Number(b.focus) - Number(a.focus) || b.episodesThisWeek - b.episodesPrevWeek - (a.episodesThisWeek - a.episodesPrevWeek) || b.episodesThisWeek - a.episodesThisWeek)
    .slice(0, 5)
    .map((x) => ({ name: x.name, episodesThisWeek: x.episodesThisWeek, episodesPrevWeek: x.episodesPrevWeek, trend: x.trend, perfIndex: x.perfIndex, per1k: x.per1k, viewsGained7d: x.viewsGained7d, confidence: x.confidence.level, focus: x.focus }));

  const audience: AudienceBrief[] = (await topAudienceThemes(4)).map((t) => ({ kind: t.kind, label: t.label, support: t.support, videos: t.videos, quote: (t.quotes as string[])[0] ?? null, interviewQuestion: (t.interviewQuestions as string[])[0] ?? null }));

  // Who to contact: the top scored guests plus verified-disclosure sponsors, with the founder's own saved contact routes and the live draft.
  const targets = await listTargets({ guests: 3, sponsors: 1 });
  const outreach: OutreachBrief[] = [];
  for (const tg of targets) {
    const ev = tg.draft ? ((tg.draft.evidence as { episodes?: { title: string; podcast: string; date: string; url: string | null }[] }).episodes ?? []) : [];
    outreach.push({ kind: tg.kind, name: tg.name, company: tg.company, score: tg.score, why: tg.reasons, evidence: ev.slice(0, 2), contacts: tg.contacts.map((c) => ({ kind: c.kind, value: c.value, verified: c.verified })), subject: tg.draft?.subject ?? null, body: tg.draft?.body ?? null, status: tg.draft?.status ?? null });
  }

  // The action plan is chosen by rule from the data above, not written by the AI.
  const topGuest = outreach.find((o) => o.kind === "guest");
  const topSector = sectors.find((x) => x.trend === "rising" || x.trend === "new") ?? sectors[0];
  const topSponsor = sponsors.find((x) => x.disclosedEpisodes > 0);
  const plan: ActionPlan = {
    guest: topGuest ? { name: topGuest.name, reason: topGuest.why[0] ?? "highest opportunity score this week" } : null,
    topic: topSector ? { name: topSector.name, reason: `${topSector.episodesThisWeek} episodes this week vs ${topSector.episodesPrevWeek} the week before${topSector.perfIndex !== null ? `, performing at ${topSector.perfIndex}x its shows' norm` : ""}` } : null,
    sponsor: topSponsor ? { name: topSponsor.name, reason: `disclosed on ${topSponsor.disclosedEpisodes} episode(s) across ${topSponsor.disclosedShows} show(s)` } : null,
    sponsorNote: topSponsor ? null : "No brand was disclosed as a sponsor this period, so there is no verified sponsor to pitch. Promo-link brands are listed above as unverified leads only.",
  };

  const multi = guestRows.filter((g) => g.distinctPodcasts >= 2).length;
  return {
    weekStart,
    period: { label: weekLabel(weekStart), from: range.from.toISOString(), to: range.to.toISOString(), previousLabel: weekLabel(addDays(weekStart, -7)) },
    activity: { episodes: Number(act?.eps ?? 0), previousEpisodes: Number(act?.prevEps ?? 0), shows: Number(act?.shows ?? 0), previousShows: Number(act?.prevShows ?? 0), newGuests: Number(act?.newG ?? 0), previousNewGuests: Number(act?.prevNewG ?? 0) },
    generatedAt: generatedAt.toISOString(),
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
    sectors,
    audience,
    outreach,
    plan,
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
