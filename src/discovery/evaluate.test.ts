import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/research/config";
import { engagementOf, evaluateTrend, publishingMetrics, relevanceOf, type CandidateEpisode } from "./evaluate";

const now = new Date("2026-10-12T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const cfg = { ...DEFAULT_CONFIG, keywords: ["AI agents"], categories: [], priorityTopics: [] as never[], founders: [], companies: [], products: [], excludedKeywords: ["cricket"] } as typeof DEFAULT_CONFIG;
const ep = (title: string, d: number, extra: Partial<CandidateEpisode> = {}): CandidateEpisode => ({ title, publishedAt: daysAgo(d), ...extra });

// a weekly show: one episode every 7 days for 12 weeks
const weekly = (titleFor: (i: number) => string) => Array.from({ length: 12 }, (_, i) => ep(titleFor(i), 2 + i * 7));

describe("publishing metrics", () => {
  it("recognises a steady weekly show", () => {
    const m = publishingMetrics(weekly(() => "x"), now);
    expect(m.episodes90d).toBe(12);
    expect(m.regular).toBe(true);
    expect(m.avgGapDays).toBeCloseTo(7, 0);
  });

  it("does not call a show with one burst and long silence regular", () => {
    const m = publishingMetrics([ep("a", 60), ep("b", 59), ep("c", 58), ep("d", 57), ep("e", 56)], now);
    expect(m.regular).toBe(false);
  });
});

describe("relevance", () => {
  it("scores a show whose episodes match the founder's keywords", () => {
    const eps = weekly((i) => (i % 2 === 0 ? `Building AI agents, part ${i}` : "Founder story"));
    const r = relevanceOf(eps, cfg, publishingMetrics(eps, now), now);
    expect(r.matchedInterests).toContain("ai agents");
    expect(r.relevantEpisodes90d).toBe(6);
    expect(r.score).toBeGreaterThan(40);
  });

  it("penalises a show full of excluded content", () => {
    const eps = weekly(() => "Cricket and AI agents");
    const r = relevanceOf(eps, cfg, publishingMetrics(eps, now), now);
    expect(r.excludedShare).toBeGreaterThan(0.3);
    expect(r.score).toBe(0);
  });
});

describe("trending is strict", () => {
  const steady = weekly((i) => `AI agents episode ${i}`);

  it("labels a steady show with growing relevant coverage and rising views as trending", () => {
    const eps = weekly((i) => (i < 6 ? `AI agents ${i}` : "Other topic")).map((e, i) => ({ ...e, views: 1000 + (12 - i) * 100 }));
    // 4 relevant in the last 30 days vs 2 in the 30 days before; views fall with age so recent is higher
    const m = publishingMetrics(eps, now);
    const r = relevanceOf(eps, cfg, m, now);
    const t = evaluateTrend({ metrics: m, relevance: r, engagement: engagementOf(eps), priorSnapshots: [] });
    expect(r.relevantEpisodes30d).toBeGreaterThanOrEqual(2);
    expect(t.label).toBe("trending");
  });

  it("does not call a show trending on one recent relevant video", () => {
    const eps = weekly((i) => (i === 0 ? "AI agents launch" : "Other topic"));
    const m = publishingMetrics(eps, now);
    const r = relevanceOf(eps, cfg, m, now);
    expect(evaluateTrend({ metrics: m, relevance: r, engagement: null, priorSnapshots: [] }).label).not.toBe("trending");
  });

  it("does not call a show trending on popularity alone", () => {
    const eps = weekly(() => "Other topic").map((e) => ({ ...e, views: 5_000_000 }));
    const m = publishingMetrics(eps, now);
    const r = relevanceOf(eps, cfg, m, now);
    const t = evaluateTrend({ metrics: m, relevance: r, engagement: engagementOf(eps), priorSnapshots: [] });
    expect(t.label).not.toBe("trending");
  });

  it("needs a second signal besides growth", () => {
    // growth in relevant episodes but the cadence is erratic and there is no engagement or history
    const eps = [ep("AI agents a", 3), ep("AI agents b", 5), ep("AI agents c", 8), ep("AI agents d", 80)];
    const m = publishingMetrics(eps, now);
    const r = relevanceOf(eps, cfg, m, now);
    const t = evaluateTrend({ metrics: m, relevance: r, engagement: null, priorSnapshots: [] });
    expect(t.signalsMet).toBeLessThan(2);
    expect(t.label).not.toBe("trending");
  });

  it("an inactive show is inactive even if it once matched", () => {
    const eps = weekly(() => "AI agents").map((e) => ({ ...e, publishedAt: new Date(e.publishedAt.getTime() - 70 * 86_400_000) }));
    const m = publishingMetrics(eps, now);
    const r = relevanceOf(eps, cfg, m, now);
    expect(evaluateTrend({ metrics: m, relevance: r, engagement: null, priorSnapshots: [] }).label).toBe("inactive");
  });

  it("a burst of uploads from a brand-new show is not trending", () => {
    // 38 relevant episodes in the last 3 weeks and nothing before: new or bulk-uploaded, not growth
    const eps = Array.from({ length: 38 }, (_, i) => ep(`AI agents ${i}`, 1 + (i % 20)));
    const m = publishingMetrics(eps, now);
    const r = relevanceOf(eps, cfg, m, now);
    const t = evaluateTrend({ metrics: m, relevance: r, engagement: null, priorSnapshots: [] });
    expect(m.regular).toBe(false);
    expect(r.relevantEpisodesPrev30d).toBe(0);
    expect(t.label).not.toBe("trending");
  });

  it("engagement needs enough videos to count", () => {
    expect(engagementOf([ep("a", 1, { views: 10 }), ep("b", 2, { views: 20 })])).toBeNull();
    expect(steady.length).toBe(12);
  });
});
