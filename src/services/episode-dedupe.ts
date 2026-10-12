import { normalize } from "@/nlp/verify";

// Same-show duplicates that a title comparison cannot see: an episode re-uploaded or re-titled with the same
// description. Both a re-title (SparX) and a trailer-plus-episode would otherwise inflate every count.

const DAY = 86_400_000;

/**
 * A fingerprint of the WHOLE description (first 4,000 characters). Using only the opening is wrong: many shows paste the
 * same links and boilerplate at the top of every episode, so two different episodes would look identical.
 * Short or empty descriptions give no fingerprint.
 */
export function descriptionKey(description: string | null | undefined): string | null {
  const n = normalize(description ?? "").slice(0, 4000);
  return n.length >= 120 ? n : null;
}

export type KnownEpisode = { dedupeKey: string; descKey: string | null; publishedAt: Date };

/**
 * True when `candidate` is the same episode as one we already have, published again within 3 days under a
 * different title. A different description, or no usable description, is never treated as a duplicate.
 */
export function isReupload(candidate: KnownEpisode, known: KnownEpisode[]): boolean {
  if (!candidate.descKey) return false;
  return known.some((k) => k.dedupeKey !== candidate.dedupeKey && k.descKey === candidate.descKey && Math.abs(k.publishedAt.getTime() - candidate.publishedAt.getTime()) <= 3 * DAY);
}

/** itunes:duration is "3600", "1:02:03" or "62:03". Anything else is unknown. */
export function durationToSeconds(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const parts = String(raw).trim().split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const sec = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return sec > 0 && sec < 24 * 3600 ? Math.round(sec) : null;
}

/** Do an RSS episode and a YouTube video look like the same recording? Unknown durations never block a match. */
export function durationsCompatible(a: number | null, b: number | null): boolean {
  if (!a || !b) return true;
  return Math.abs(a - b) / Math.max(a, b) <= 0.25;
}
