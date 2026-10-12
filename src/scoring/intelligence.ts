// Phase 3 scoring. Same rules as formulas.ts: every input is a count, date or API-reported number; no AI-written
// number goes in. Where an input is missing the function says so (null) rather than substituting a guess.

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------- engagement
/** Average views per day since publication (age floored at 1 day so a brand-new video is not infinite). */
export function viewsPerDay(views: number, ageDays: number): number {
  return views / Math.max(1, ageDays);
}

/**
 * How a video performs against ITS OWN SHOW'S normal: 1.0 = typical, 2.0 = twice the show's median views per day.
 * Comparing within a show matters because a 5M-view channel and a 20k-view channel are not comparable in absolute terms.
 * Needs at least 3 videos in the show to define "typical"; otherwise null.
 */
export function performanceIndex(vpd: number, showVpds: number[]): number | null {
  if (showVpds.length < 3) return null;
  const m = median(showVpds);
  return m && m > 0 ? round(vpd / m) : null;
}

/** (likes + comments) per 1,000 views. Null when likes are hidden or there are no views. */
export function engagementPer1k(views: number, likes: number | null, comments: number | null): number | null {
  if (!views || (likes === null && comments === null)) return null;
  return round((((likes ?? 0) + (comments ?? 0)) / views) * 1000, 1);
}

export type Snapshot = { on: string; views: number };

/**
 * Real growth: views gained per day between the oldest and newest snapshot in the window. Needs two snapshots at least a
 * day apart; with fewer it returns null ("not enough history yet") instead of guessing.
 */
export function viewVelocity(snaps: Snapshot[]): { perDay: number; gained: number; days: number } | null {
  if (snaps.length < 2) return null;
  const s = [...snaps].sort((a, b) => a.on.localeCompare(b.on));
  const days = (Date.parse(s[s.length - 1].on) - Date.parse(s[0].on)) / 86_400_000;
  if (days < 1) return null;
  const gained = s[s.length - 1].views - s[0].views;
  return { perDay: round(gained / days, 1), gained, days };
}

// ---------------------------------------------------------------- evidence confidence
export type EvidenceInputs = {
  evidenceItems: number; // independent pieces of evidence (episodes / quotes)
  distinctShows: number;
  transcriptBacked: boolean; // at least one item came from a transcript, not just a description
  modelConfidence: number | null; // average of Gemini's own 0-1 confidence, which is only one input among several
  platformConfirmed?: boolean; // e.g. YouTube's paid-placement flag
};
export type Confidence = { level: "high" | "medium" | "low"; score: number; reasons: string[] };

/**
 * Confidence is about the EVIDENCE, not the model's self-assessment. More independent items, more shows, a transcript or
 * a platform flag all raise it; the model's own confidence is capped to 20% of the score so it cannot carry it alone.
 */
export function evidenceConfidence(i: EvidenceInputs): Confidence {
  const reasons: string[] = [];
  const items = clamp01(i.evidenceItems / 4);
  const shows = clamp01(i.distinctShows / 3);
  const model = clamp01(i.modelConfidence ?? 0.5);
  const score = items * 0.35 + shows * 0.25 + (i.transcriptBacked ? 0.15 : 0) + (i.platformConfirmed ? 0.05 : 0) + model * 0.2;
  reasons.push(`${i.evidenceItems} piece${i.evidenceItems === 1 ? "" : "s"} of evidence on ${i.distinctShows} show${i.distinctShows === 1 ? "" : "s"}`);
  reasons.push(i.transcriptBacked ? "includes transcript evidence" : "from titles and descriptions only");
  if (i.platformConfirmed) reasons.push("platform-confirmed");
  const s = round(score);
  return { level: s >= 0.65 ? "high" : s >= 0.4 ? "medium" : "low", score: s, reasons };
}

// ---------------------------------------------------------------- opportunity rubric
export type RubricWeights = Record<string, number>;

export const DEFAULT_GUEST_RUBRIC: RubricWeights = { reach: 0.3, recency: 0.25, focus: 0.2, audiencePull: 0.15, confidence: 0.1 };
export const DEFAULT_SPONSOR_RUBRIC: RubricWeights = { disclosure: 0.35, recency: 0.2, reach: 0.2, focus: 0.15, confidence: 0.1 };

export type Criterion = { key: string; label: string; value: number | null; weight: number; note: string };
export type Opportunity = { score: number; criteria: Criterion[]; missing: string[] };

/** Weighted sum over the criteria that have data. A missing input is excluded and the remaining weights are re-scaled, and it is listed. */
function weigh(parts: { key: string; label: string; value: number | null; note: string }[], w: RubricWeights): Opportunity {
  const present = parts.filter((p) => p.value !== null);
  const total = present.reduce((a, p) => a + (w[p.key] ?? 0), 0) || 1;
  let score = 0;
  const criteria: Criterion[] = parts.map((p) => {
    const weight = p.value === null ? 0 : (w[p.key] ?? 0) / total;
    score += (p.value ?? 0) * weight;
    return { key: p.key, label: p.label, value: p.value === null ? null : round(p.value), weight: round(weight), note: p.note };
  });
  return { score: round(score * 100, 1), criteria, missing: parts.filter((p) => p.value === null).map((p) => p.label) };
}

const recencyHalfLife = (days: number | null, half: number) => (days === null ? null : round(Math.pow(0.5, days / half), 3));

export type GuestOpportunityInputs = { distinctShows: number; appearances: number; daysSinceLast: number | null; focus: boolean; performanceIndex: number | null; confidence: number };

/** How attractive a guest is to approach: reach across shows, freshness, fit with the founder's focus, audience pull, evidence. */
export function guestOpportunity(i: GuestOpportunityInputs, w: RubricWeights = DEFAULT_GUEST_RUBRIC): Opportunity {
  return weigh(
    [
      { key: "reach", label: "Reach across shows", value: clamp01(i.distinctShows / 3), note: `${i.distinctShows} show(s), ${i.appearances} appearance(s); 3 shows = full marks` },
      { key: "recency", label: "Recency", value: recencyHalfLife(i.daysSinceLast, 21), note: i.daysSinceLast === null ? "no date" : `last seen ${Math.round(i.daysSinceLast)} day(s) ago; halves every 21 days` },
      { key: "focus", label: "Fit with your focus", value: i.focus ? 1 : 0, note: i.focus ? "matches your research settings" : "does not match your research settings" },
      { key: "audiencePull", label: "Audience pull", value: i.performanceIndex === null ? null : clamp01((i.performanceIndex - 0.5) / 1.5), note: i.performanceIndex === null ? "no engagement data for their episodes" : `their episodes ran at ${i.performanceIndex}x their show's typical views per day` },
      { key: "confidence", label: "Evidence confidence", value: clamp01(i.confidence), note: "average extraction confidence" },
    ],
    w,
  );
}

export type SponsorOpportunityInputs = { disclosedEpisodes: number; shows: number; daysSinceLast: number | null; focus: boolean; confidence: number };

/** How solid a sponsor lead is: disclosed deals count; promo-link-only brands score low because nothing is confirmed. */
export function sponsorOpportunity(i: SponsorOpportunityInputs, w: RubricWeights = DEFAULT_SPONSOR_RUBRIC): Opportunity {
  return weigh(
    [
      { key: "disclosure", label: "Verified disclosure", value: clamp01(i.disclosedEpisodes / 3), note: `${i.disclosedEpisodes} disclosed episode(s); promo links without disclosure count for nothing here` },
      { key: "recency", label: "Recency", value: recencyHalfLife(i.daysSinceLast, 30), note: i.daysSinceLast === null ? "no date" : `last seen ${Math.round(i.daysSinceLast)} day(s) ago; halves every 30 days` },
      { key: "reach", label: "Reach across shows", value: clamp01(i.shows / 3), note: `${i.shows} show(s)` },
      { key: "focus", label: "Fit with your focus", value: i.focus ? 1 : 0, note: i.focus ? "matches your research settings" : "does not match" },
      { key: "confidence", label: "Evidence confidence", value: clamp01(i.confidence), note: "average extraction confidence" },
    ],
    w,
  );
}

/** Keep only known keys, non-negative numbers, and require something to weigh. Used when the founder edits a rubric. */
export function sanitizeWeights(input: Record<string, unknown>, allowed: string[]): RubricWeights | null {
  const out: RubricWeights = {};
  for (const k of allowed) {
    const v = Number(input[k]);
    if (!Number.isFinite(v) || v < 0 || v > 1) return null;
    out[k] = v;
  }
  return Object.values(out).some((v) => v > 0) ? out : null;
}
