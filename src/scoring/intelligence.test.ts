import { describe, expect, it } from "vitest";
import { DEFAULT_GUEST_RUBRIC, engagementPer1k, evidenceConfidence, guestOpportunity, median, performanceIndex, sanitizeWeights, sponsorOpportunity, viewsPerDay, viewVelocity } from "./intelligence";

describe("engagement signals", () => {
  it("compares a video with its own show, not with the whole platform", () => {
    expect(performanceIndex(2000, [1000, 1000, 1000, 1000])).toBe(2);
    expect(performanceIndex(10, [10, 10, 10])).toBe(1);
  });
  it("refuses to define 'typical' from fewer than three videos", () => {
    expect(performanceIndex(500, [400, 600])).toBeNull();
  });
  it("floors age at one day and handles the median of even and odd sets", () => {
    expect(viewsPerDay(900, 0)).toBe(900);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("computes engagement per 1,000 views and survives hidden likes", () => {
    expect(engagementPer1k(10_000, 400, 100)).toBe(50);
    expect(engagementPer1k(10_000, null, 100)).toBe(10);
    expect(engagementPer1k(10_000, null, null)).toBeNull();
    expect(engagementPer1k(0, 5, 5)).toBeNull();
  });
  it("only reports velocity from two snapshots at least a day apart", () => {
    expect(viewVelocity([{ on: "2026-10-12", views: 100 }])).toBeNull();
    expect(viewVelocity([{ on: "2026-10-12", views: 100 }, { on: "2026-10-12", views: 150 }])).toBeNull();
    expect(viewVelocity([{ on: "2026-10-12", views: 1000 }, { on: "2026-10-05", views: 300 }])).toEqual({ perDay: 100, gained: 700, days: 7 });
  });
});

describe("evidence confidence", () => {
  it("rises with independent evidence and falls without it, whatever the model says", () => {
    const strong = evidenceConfidence({ evidenceItems: 4, distinctShows: 3, transcriptBacked: true, modelConfidence: 0.9 });
    const weak = evidenceConfidence({ evidenceItems: 1, distinctShows: 1, transcriptBacked: false, modelConfidence: 1 });
    expect(strong.level).toBe("high");
    expect(weak.level).toBe("low");
    expect(strong.score).toBeGreaterThan(weak.score);
  });
  it("explains itself", () => {
    expect(evidenceConfidence({ evidenceItems: 2, distinctShows: 2, transcriptBacked: false, modelConfidence: null }).reasons.join(" ")).toContain("titles and descriptions only");
  });
});

describe("guest opportunity rubric", () => {
  const base = { distinctShows: 2, appearances: 2, daysSinceLast: 5, focus: true, performanceIndex: 2, confidence: 0.9 };
  it("scores 0-100 and every criterion explains itself", () => {
    const o = guestOpportunity(base);
    expect(o.score).toBeGreaterThan(0);
    expect(o.score).toBeLessThanOrEqual(100);
    expect(o.criteria.every((c) => c.note.length > 0)).toBe(true);
    expect(o.criteria.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 1);
  });
  it("excludes a missing input and rescales instead of inventing a value", () => {
    const o = guestOpportunity({ ...base, performanceIndex: null });
    expect(o.missing).toEqual(["Audience pull"]);
    expect(o.criteria.find((c) => c.key === "audiencePull")).toMatchObject({ value: null, weight: 0 });
    expect(o.criteria.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(1, 1);
  });
  it("prefers a fresher, wider, better-fitting guest", () => {
    const better = guestOpportunity(base).score;
    expect(guestOpportunity({ ...base, daysSinceLast: 60 }).score).toBeLessThan(better);
    expect(guestOpportunity({ ...base, focus: false }).score).toBeLessThan(better);
    expect(guestOpportunity({ ...base, distinctShows: 1 }).score).toBeLessThan(better);
  });
  it("changes when the founder changes the weights", () => {
    const focusHeavy = guestOpportunity({ ...base, focus: false }, { ...DEFAULT_GUEST_RUBRIC, focus: 0.9 }).score;
    expect(focusHeavy).toBeLessThan(guestOpportunity({ ...base, focus: false }).score);
  });
});

describe("sponsor opportunity rubric", () => {
  it("gives no verification credit to a brand with only promo links", () => {
    const promo = sponsorOpportunity({ disclosedEpisodes: 0, shows: 1, daysSinceLast: 3, focus: false, confidence: 0.8 });
    const disclosed = sponsorOpportunity({ disclosedEpisodes: 2, shows: 1, daysSinceLast: 3, focus: false, confidence: 0.8 });
    expect(promo.criteria.find((c) => c.key === "disclosure")!.value).toBe(0);
    expect(disclosed.score).toBeGreaterThan(promo.score + 10);
  });
});

describe("editing a rubric", () => {
  const keys = Object.keys(DEFAULT_GUEST_RUBRIC);
  it("accepts a full valid set and rejects bad ones", () => {
    expect(sanitizeWeights({ reach: 0.5, recency: 0.5, focus: 0, audiencePull: 0, confidence: 0 }, keys)).not.toBeNull();
    expect(sanitizeWeights({ reach: 2, recency: 0, focus: 0, audiencePull: 0, confidence: 0 }, keys)).toBeNull();
    expect(sanitizeWeights({ reach: 0.5 }, keys)).toBeNull();
    expect(sanitizeWeights({ reach: 0, recency: 0, focus: 0, audiencePull: 0, confidence: 0 }, keys)).toBeNull();
  });
});
