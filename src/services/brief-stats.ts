import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getGuestRadar, getSponsorRadar, getTopicRadar, parsePeriod } from "@/services/radars";

// Everything in the brief that is a fact comes from here: SQL counts and the same scoring code the
// dashboards use. Gemini never produces these numbers; it only comments on them.

type Ep = { title: string; url: string | null; podcast: string; at: string };

export type BriefStats = {
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
  const guestWindowDays = 30;
  const guestRows = await getGuestRadar({ period: parsePeriod("30d", now) });
  // Prefer people on several shows, then by score; drop journalists (filtered already) and likely staff.
  const candidates = guestRows
    .filter((g) => !g.likelyStaff && !g.needsReview)
    .sort((a, b) => b.distinctPodcasts - a.distinctPodcasts || b.score.score - a.score.score);
  const weekAgo = now.getTime() - 7 * 86_400_000;

  const topicRows = await getTopicRadar();
  const prev = await rows<{ entityId: number; score: string }>(sql`
    select entity_id as "entityId", score from score_snapshots
    where kind = 'topic' and week_start = (select max(week_start) from score_snapshots where kind = 'topic' and week_start < ${weekStart}::date)`);
  const prevScore = new Map(prev.map((p) => [Number(p.entityId), Number(p.score)]));

  const sponsorRows = await getSponsorRadar({ period: parsePeriod("90d", now) });

  const [health] = await rows<{ eps: number; errors: number; failed: number }>(sql`
    select (select count(*) from episodes e join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= now() - interval '7 days')::int as eps,
           (select count(*) from podcasts where enabled and last_sync_status = 'error')::int as errors,
           (select count(*) from analysis_jobs where status = 'failed')::int as failed`);
  const [lastRun] = await rows<{ startedAt: string; status: string }>(sql`
    select started_at as "startedAt", status from job_runs where job = 'daily' order by started_at desc limit 1`);

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
      sampleEpisodes: t.episodes.slice(0, 3).map(trim),
    }));

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
    };
  });

  const multi = guestRows.filter((g) => g.distinctPodcasts >= 2).length;
  return {
    weekStart,
    generatedAt: now.toISOString(),
    guests,
    guestEvidence: { windowDays: guestWindowDays, guestsInWindow: guestRows.length, onMultipleShows: multi, sufficient: multi >= 1 },
    topics,
    sponsors,
    sponsorEvidence: {
      windowDays: 90,
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
