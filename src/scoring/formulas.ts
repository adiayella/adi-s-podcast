// Transparent 0-100 scores. Every input is a count or date computed by SQL; no AI number goes in.
// Each component is normalised to 0..1 against a FIXED cap (not against the current maximum), so a
// score does not change just because someone else's numbers changed. Weights are configurable.

export type Weights = Record<string, number>;

export const NORMALISATION = {
  guest: { podcastsCap: 3, appearancesCap: 4, recencyDays: 30 },
  topic: { podcastsCap: 5, recencyDays: 14 },
  sponsor: { occurrencesCap: 5, podcastsCap: 3, recencyDays: 30 },
} as const;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 1 when it happened today, falling linearly to 0 after `days`. Missing date = 0 (no evidence of recency). */
export function recency(daysSince: number | null, days: number): number {
  return daysSince === null ? 0 : clamp01(1 - daysSince / days);
}

export type ScoreResult = { score: number; components: Record<string, { value: number; weight: number }> };

function combine(parts: Record<string, number>, weights: Weights): ScoreResult {
  const total = Object.keys(parts).reduce((s, k) => s + (weights[k] ?? 0), 0) || 1; // tolerate weights that do not sum to 1
  const components: ScoreResult["components"] = {};
  let score = 0;
  for (const [k, v] of Object.entries(parts)) {
    const weight = (weights[k] ?? 0) / total;
    components[k] = { value: round1(v * 100) / 100, weight: round1(weight * 100) / 100 };
    score += v * weight;
  }
  return { score: round1(score * 100), components };
}

export type GuestInputs = { distinctPodcasts: number; appearances: number; daysSinceLast: number | null; confidence: number | null };

export function guestScore(i: GuestInputs, w: Weights): ScoreResult {
  const n = NORMALISATION.guest;
  return combine(
    {
      distinctPodcasts: clamp01(i.distinctPodcasts / n.podcastsCap),
      totalAppearances: clamp01(i.appearances / n.appearancesCap),
      recency: recency(i.daysSinceLast, n.recencyDays),
      confidence: clamp01(i.confidence ?? 0),
    },
    w,
  );
}

export type TopicInputs = {
  distinctPodcasts: number;
  episodesThisWeek: number;
  episodesPrevWeek: number;
  daysSinceLast: number | null;
  confidence: number | null;
};

/** Growth is this week's share of the two-week total: 0.5 = flat, 1 = brand new, 0 = vanished. */
export function growthShare(thisWeek: number, prevWeek: number): number {
  const total = thisWeek + prevWeek;
  return total === 0 ? 0 : thisWeek / total;
}

export function topicScore(i: TopicInputs, w: Weights): ScoreResult {
  const n = NORMALISATION.topic;
  return combine(
    {
      distinctPodcasts: clamp01(i.distinctPodcasts / n.podcastsCap),
      growth: growthShare(i.episodesThisWeek, i.episodesPrevWeek),
      recency: recency(i.daysSinceLast, n.recencyDays),
      confidence: clamp01(i.confidence ?? 0),
    },
    w,
  );
}

export type SponsorInputs = {
  confirmedOccurrences: number;
  distinctConfirmedPodcasts: number;
  daysSinceLastConfirmed: number | null;
  confidence: number | null;
};

/** Only DISCLOSED sponsorships (explicit or paid wording) feed the score. Unverified promos are counted elsewhere. */
export function sponsorScore(i: SponsorInputs, w: Weights): ScoreResult {
  const n = NORMALISATION.sponsor;
  return combine(
    {
      confirmedOccurrences: clamp01(i.confirmedOccurrences / n.occurrencesCap),
      distinctPodcasts: clamp01(i.distinctConfirmedPodcasts / n.podcastsCap),
      recency: recency(i.daysSinceLastConfirmed, n.recencyDays),
      confidence: clamp01(i.confidence ?? 0),
    },
    w,
  );
}

export type OutreachTier = "A" | "B" | "C" | "D";

/**
 * Outreach priority for a brand, from evidence strength:
 *  A: disclosed sponsor on 2+ shows        B: disclosed on 1 show, or flagged paid by YouTube on 2+ episodes
 *  C: promotional link/code seen            D: unclear promotional mention
 */
export function outreachTier(i: { confirmedPodcasts: number; confirmedEpisodes: number; platformFlaggedEpisodes: number; promoEpisodes: number }): OutreachTier {
  if (i.confirmedPodcasts >= 2) return "A";
  if (i.confirmedEpisodes >= 1 || i.platformFlaggedEpisodes >= 2) return "B";
  if (i.promoEpisodes >= 1) return "C";
  return "D";
}
