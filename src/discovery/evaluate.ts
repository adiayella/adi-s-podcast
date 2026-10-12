import { episodeFocus, type FocusConfig } from "@/research/focus";

// Pure evaluation of a discovery candidate from real feed data. No database, no network.

export type CandidateEpisode = {
  title: string;
  description?: string | null;
  publishedAt: Date;
  url?: string | null;
  views?: number | null;
  topics?: string[]; // from Gemini analysis, when available
};

const DAY = 86_400_000;

export type PublishingMetrics = {
  episodes30d: number;
  episodesPrev30d: number;
  episodes90d: number;
  daysSinceLast: number | null;
  avgGapDays: number | null;
  gapVariation: number | null; // std dev of the gaps divided by their mean; low = steady cadence
  activeWeeks: number; // distinct weeks (of the last 13) with at least one episode: a burst covers few weeks
  regular: boolean;
};

export function publishingMetrics(episodes: CandidateEpisode[], now = new Date()): PublishingMetrics {
  const times = episodes.map((e) => e.publishedAt.getTime()).filter((t) => t <= now.getTime() + DAY).sort((a, b) => b - a);
  const within = (from: number, to: number) => times.filter((t) => now.getTime() - t >= from * DAY && now.getTime() - t < to * DAY).length;
  const in90 = times.filter((t) => now.getTime() - t < 90 * DAY);
  const gaps: number[] = [];
  for (let i = 0; i < in90.length - 1; i++) gaps.push((in90[i] - in90[i + 1]) / DAY);
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const variation = avg && gaps.length >= 3 ? Math.sqrt(gaps.reduce((s, g) => s + (g - avg) ** 2, 0) / gaps.length) / avg : null;
  const daysSinceLast = times.length ? (now.getTime() - times[0]) / DAY : null;
  const activeWeeks = new Set(in90.map((t) => Math.floor((now.getTime() - t) / (7 * DAY)))).size;
  const regular = in90.length >= 4 && activeWeeks >= 6 && variation !== null && variation <= 1 && daysSinceLast !== null && avg !== null && daysSinceLast <= Math.min(30, Math.max(7, avg * 2.5));
  return { episodes30d: within(0, 30), episodesPrev30d: within(30, 60), episodes90d: in90.length, daysSinceLast, avgGapDays: avg, gapVariation: variation, activeWeeks, regular };
}

export type Relevance = {
  score: number; // 0-100
  matchedInterests: string[];
  relevantEpisodes90d: number;
  relevantEpisodes30d: number;
  relevantEpisodesPrev30d: number;
  excludedShare: number;
  components: { interests: number; relevantShare: number; regularity: number };
};

/** How well a show's recent episodes match what the founder asked for. Excluded content counts against it. */
export function relevanceOf(episodes: CandidateEpisode[], config: FocusConfig, metrics: PublishingMetrics, now = new Date()): Relevance {
  const recent = episodes.filter((e) => now.getTime() - e.publishedAt.getTime() < 90 * DAY);
  const interests = new Set<string>();
  let relevant90 = 0;
  let relevant30 = 0;
  let relevantPrev = 0;
  let excluded = 0;
  for (const e of recent) {
    const f = episodeFocus({ title: e.title, description: e.description, topics: e.topics ?? [], podcastId: -1 }, config);
    if (f.excluded) excluded++;
    if (f.matches.length || f.preferredTopics.length) {
      if (f.excluded) continue;
      relevant90++;
      f.matches.forEach((m) => interests.add(m.toLowerCase()));
      const age = (now.getTime() - e.publishedAt.getTime()) / DAY;
      if (age < 30) relevant30++;
      else if (age < 60) relevantPrev++;
    }
  }
  const total = recent.length || 1;
  const interestScore = Math.min(interests.size / 3, 1);
  const shareScore = relevant90 / total;
  const regularity = metrics.regular ? 1 : metrics.episodes90d >= 3 ? 0.5 : 0;
  // A steady cadence is not relevance: with no matching episodes the score is 0.
  let score = relevant90 === 0 ? 0 : 100 * (0.4 * interestScore + 0.4 * shareScore + 0.2 * regularity);
  const excludedShare = excluded / total;
  if (excludedShare > 0.3) score *= 0.5;
  return {
    score: Math.round(score * 10) / 10,
    matchedInterests: [...interests],
    relevantEpisodes90d: relevant90,
    relevantEpisodes30d: relevant30,
    relevantEpisodesPrev30d: relevantPrev,
    excludedShare: Math.round(excludedShare * 100) / 100,
    components: { interests: Math.round(interestScore * 100) / 100, relevantShare: Math.round(shareScore * 100) / 100, regularity },
  };
}

export type Engagement = { videos: number; medianViews: number | null; recentMedianViews: number | null; earlierMedianViews: number | null };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Views per video where a YouTube channel is known. Recent half vs earlier half shows direction. */
export function engagementOf(episodes: CandidateEpisode[]): Engagement | null {
  const withViews = episodes.filter((e) => typeof e.views === "number").sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  if (withViews.length < 4) return null;
  const half = Math.floor(withViews.length / 2);
  const views = withViews.map((e) => e.views as number);
  return { videos: withViews.length, medianViews: median(views), recentMedianViews: median(views.slice(0, half)), earlierMedianViews: median(views.slice(half)) };
}

/** The discovery "trending" rule in words, kept next to evaluateTrend so the two cannot drift apart. */
export const DISCOVERY_TREND_RUBRIC = {
  version: "discovery-trend-v1",
  signals: [
    { label: "Consistent publishing", rule: "Steady cadence, 6+ episodes in 90 days, spread over 8+ different weeks (a burst does not count)." },
    { label: "Growth in relevant episodes", rule: "Episodes matching your focus: last 30 days at least 1.25x the 30 days before, with 2+ in each window." },
    { label: "Engagement or history rising", rule: "YouTube median views of recent videos 1.2x+ earlier ones, or more relevant episodes than at our earlier checks." },
  ],
  labels: [
    { label: "trending", rule: "Relevance 40+ AND growth in relevant episodes AND at least 2 of the 3 signals." },
    { label: "active", rule: "Relevance 30+, an episode in the last 30 days and 3+ in 90 days." },
    { label: "inactive", rule: "Anything else." },
  ],
} as const;

export type TrendLabel = "trending" | "active" | "inactive";
export type TrendResult = { label: TrendLabel; signals: { name: string; met: boolean; detail: string }[]; signalsMet: number };

export type PriorSnapshot = { relevantEpisodes30d: number };

/**
 * "Trending" needs at least two independent signals, and one of them must be growth in RELEVANT episodes:
 *   1. consistent publishing   2. relevant episodes grew vs the previous 30 days   3. engagement or history growth.
 * Popularity alone, or a single recent video, can never make a show trending.
 */
export function evaluateTrend(input: { metrics: PublishingMetrics; relevance: Relevance; engagement: Engagement | null; priorSnapshots: PriorSnapshot[] }): TrendResult {
  const { metrics: m, relevance: r, engagement: e, priorSnapshots } = input;

  // A burst of uploads is not consistency, and a jump from zero is a new show, not growth: both need a real baseline.
  const consistent = m.regular && m.episodes90d >= 6 && m.activeWeeks >= 8;
  const growth = r.relevantEpisodesPrev30d >= 2 && r.relevantEpisodes30d >= 2 && r.relevantEpisodes30d >= r.relevantEpisodesPrev30d * 1.25;
  const engagementUp = !!e && e.recentMedianViews !== null && e.earlierMedianViews !== null && e.earlierMedianViews > 0 && e.recentMedianViews >= e.earlierMedianViews * 1.2;
  const olderCounts = priorSnapshots.map((s) => s.relevantEpisodes30d);
  const historyUp = olderCounts.length >= 2 && r.relevantEpisodes30d > Math.max(...olderCounts.slice(0, 2)) * 1;
  const corroboration = engagementUp || historyUp;

  const signals = [
    { name: "Consistent publishing", met: consistent, detail: `${m.episodes90d} episodes across ${m.activeWeeks} different weeks${m.regular ? "" : " (not steady enough)"}` },
    { name: "Growth in relevant episodes", met: growth, detail: `${r.relevantEpisodes30d} relevant episodes in the last 30 days vs ${r.relevantEpisodesPrev30d} in the 30 days before${r.relevantEpisodesPrev30d < 2 ? " (too few before to call it growth)" : ""}` },
    {
      name: "Engagement or history rising",
      met: corroboration,
      detail: e ? `median views ${Math.round(e.recentMedianViews ?? 0)} recently vs ${Math.round(e.earlierMedianViews ?? 0)} earlier` : olderCounts.length ? `${olderCounts.length} earlier checks recorded` : "no engagement data or earlier checks yet",
    },
  ];
  const signalsMet = signals.filter((s) => s.met).length;
  const active = r.score >= 30 && m.daysSinceLast !== null && m.daysSinceLast <= 30 && m.episodes90d >= 3;
  const trending = r.score >= 40 && growth && signalsMet >= 2;
  return { label: trending ? "trending" : active ? "active" : "inactive", signals, signalsMet };
}

/** Plain-language reasons, built only from the evidence above. */
export function explain(input: { name: string; relevance: Relevance; metrics: PublishingMetrics; trend: TrendResult; sampleTitles: string[] }): string {
  const { relevance: r, metrics: m, trend: t } = input;
  const parts: string[] = [];
  if (r.matchedInterests.length) parts.push(`Covers your interests: ${r.matchedInterests.slice(0, 4).join(", ")}.`);
  parts.push(`${r.relevantEpisodes90d} of ${m.episodes90d} episodes in the last 90 days match your focus.`);
  if (m.avgGapDays !== null) parts.push(`${m.avgGapDays < 0.5 ? "Publishes several episodes a day" : `Publishes about every ${m.avgGapDays.toFixed(1)} days`}${m.regular ? " on a steady cadence" : ""}; latest episode ${Math.round(m.daysSinceLast ?? 0)} day(s) ago.`);
  if (t.label === "trending") parts.push(`Trending: ${t.signals.filter((s) => s.met).map((s) => s.name.toLowerCase()).join(" and ")}.`);
  else if (t.label === "active") parts.push("Not labelled trending: not enough independent growth signals yet.");
  return parts.join(" ");
}
