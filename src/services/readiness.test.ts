import { describe, expect, it } from "vitest";
import { judgeReadiness } from "./readiness-rules";

const now = new Date("2026-10-12T01:30:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("brief readiness", () => {
  it("is ready after a recent ingest with nothing waiting", () => {
    expect(judgeReadiness({ lastIngestAt: hoursAgo(2), pendingAnalyses: 0, failedAnalyses: 0, now }).ready).toBe(true);
  });
  it("waits when analyses are still pending", () => {
    const r = judgeReadiness({ lastIngestAt: hoursAgo(2), pendingAnalyses: 3, failedAnalyses: 0, now });
    expect(r.ready).toBe(false);
    expect(r.notes.join(" ")).toContain("3 episode(s)");
  });
  it("is not ready when ingestion is stale or has never run", () => {
    expect(judgeReadiness({ lastIngestAt: hoursAgo(40), pendingAnalyses: 0, failedAnalyses: 0, now }).ready).toBe(false);
    expect(judgeReadiness({ lastIngestAt: null, pendingAnalyses: 0, failedAnalyses: 0, now }).ready).toBe(false);
  });
  it("reports failed analyses without blocking the brief", () => {
    const r = judgeReadiness({ lastIngestAt: hoursAgo(2), pendingAnalyses: 0, failedAnalyses: 2, now });
    expect(r.ready).toBe(true);
    expect(r.notes.join(" ")).toContain("2 episode analysis");
  });
});
