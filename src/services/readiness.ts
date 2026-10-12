import { analysisProgress } from "@/services/analyze";
import { lastRealRun } from "@/services/job-log";
import { judgeReadiness } from "./readiness-rules";

export type { Readiness } from "./readiness-rules";

export async function checkReadiness(now = new Date()) {
  const [last, progress] = await Promise.all([lastRealRun("focused"), analysisProgress()]);
  return judgeReadiness({ lastIngestAt: last, pendingAnalyses: Number(progress.pending ?? 0) + Number(progress.running ?? 0), failedAnalyses: Number(progress.failed ?? 0), now });
}
