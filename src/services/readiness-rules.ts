export type Readiness = { ready: boolean; notes: string[]; pendingAnalyses: number; lastIngestAt: string | null };

const MAX_INGEST_AGE_HOURS = 30; // the daily ingest runs about 2 h before the Monday brief; allow slack for a late run

/** Pure decision, so it can be tested: is the data fresh and fully analysed enough to write a brief from? */
export function judgeReadiness(input: { lastIngestAt: Date | null; pendingAnalyses: number; failedAnalyses: number; now: Date }): Readiness {
  const notes: string[] = [];
  const ageH = input.lastIngestAt ? (input.now.getTime() - input.lastIngestAt.getTime()) / 3_600_000 : Infinity;
  if (!input.lastIngestAt) notes.push("No successful ingestion run is on record.");
  else if (ageH > MAX_INGEST_AGE_HOURS) notes.push(`The last successful ingestion was ${Math.round(ageH)} hours ago.`);
  if (input.pendingAnalyses > 0) notes.push(`${input.pendingAnalyses} episode(s) are still waiting for analysis.`);
  if (input.failedAnalyses > 0) notes.push(`${input.failedAnalyses} episode analysis attempt(s) have failed and are excluded.`);
  // failed analyses are reported but do not block: they are retried on later runs and blocking would hold the brief hostage
  const ready = notes.filter((n) => !n.includes("failed and are excluded")).length === 0;
  return { ready, notes, pendingAnalyses: input.pendingAnalyses, lastIngestAt: input.lastIngestAt ? input.lastIngestAt.toISOString() : null };
}
