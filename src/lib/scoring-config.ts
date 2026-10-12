// Default weights for the three transparent 0-100 scores. Each set sums to 1.
// Stored in the `settings` table at runtime so they can be tuned without a deploy.
export const DEFAULT_WEIGHTS = {
  guest: [
    { key: "distinctPodcasts", label: "Distinct podcasts featuring the guest", weight: 0.4 },
    { key: "totalAppearances", label: "Total appearances", weight: 0.3 },
    { key: "recency", label: "Recency of appearances", weight: 0.2 },
    { key: "confidence", label: "Evidence confidence", weight: 0.1 },
  ],
  topic: [
    { key: "distinctPodcasts", label: "Podcasts covering the topic", weight: 0.4 },
    { key: "growth", label: "Week-over-week growth in frequency", weight: 0.3 },
    { key: "recency", label: "Recency", weight: 0.2 },
    { key: "confidence", label: "Evidence confidence", weight: 0.1 },
  ],
  sponsor: [
    { key: "confirmedOccurrences", label: "Confirmed sponsorship occurrences", weight: 0.4 },
    { key: "distinctPodcasts", label: "Distinct podcasts sponsored", weight: 0.3 },
    { key: "recency", label: "Recency", weight: 0.2 },
    { key: "confidence", label: "Evidence confidence", weight: 0.1 },
  ],
} as const;

export type RadarKind = keyof typeof DEFAULT_WEIGHTS;
