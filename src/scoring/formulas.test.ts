import { describe, expect, it } from "vitest";
import { growthShare, guestScore, outreachTier, recency, sponsorScore, topicScore } from "./formulas";
import { DEFAULT_WEIGHTS } from "@/lib/scoring-config";

const weights = (kind: keyof typeof DEFAULT_WEIGHTS) => Object.fromEntries(DEFAULT_WEIGHTS[kind].map((w) => [w.key, w.weight]));

describe("guest score", () => {
  it("is 100 when every component is maxed", () => {
    const r = guestScore({ distinctPodcasts: 3, appearances: 4, daysSinceLast: 0, confidence: 1 }, weights("guest"));
    expect(r.score).toBe(100);
  });

  it("matches the documented weights (40/30/20/10) by hand", () => {
    // 2 of 3 podcasts = .667, 2 of 4 appearances = .5, 15 of 30 days = .5, confidence .9
    const r = guestScore({ distinctPodcasts: 2, appearances: 2, daysSinceLast: 15, confidence: 0.9 }, weights("guest"));
    expect(r.score).toBeCloseTo(100 * (0.4 * (2 / 3) + 0.3 * 0.5 + 0.2 * 0.5 + 0.1 * 0.9), 0);
  });

  it("counts appearances on several shows above many on one show", () => {
    const wide = guestScore({ distinctPodcasts: 3, appearances: 3, daysSinceLast: 5, confidence: 0.9 }, weights("guest")).score;
    const deep = guestScore({ distinctPodcasts: 1, appearances: 4, daysSinceLast: 5, confidence: 0.9 }, weights("guest")).score;
    expect(wide).toBeGreaterThan(deep);
  });

  it("treats missing recency and confidence as zero rather than guessing", () => {
    const r = guestScore({ distinctPodcasts: 1, appearances: 1, daysSinceLast: null, confidence: null }, weights("guest"));
    expect(r.components.recency.value).toBe(0);
    expect(r.components.confidence.value).toBe(0);
  });

  it("is reproducible and always within 0..100", () => {
    const i = { distinctPodcasts: 9, appearances: 40, daysSinceLast: -3, confidence: 4 };
    const a = guestScore(i, weights("guest"));
    expect(a).toEqual(guestScore(i, weights("guest")));
    expect(a.score).toBeLessThanOrEqual(100);
    expect(a.score).toBeGreaterThanOrEqual(0);
  });

  it("re-normalises weights that do not sum to 1", () => {
    const r = guestScore({ distinctPodcasts: 3, appearances: 4, daysSinceLast: 0, confidence: 1 }, { distinctPodcasts: 4, totalAppearances: 3, recency: 2, confidence: 1 });
    expect(r.score).toBe(100);
  });
});

describe("topic score", () => {
  it("growth is 0.5 when flat, 1 when brand new, 0 when gone", () => {
    expect(growthShare(5, 5)).toBe(0.5);
    expect(growthShare(4, 0)).toBe(1);
    expect(growthShare(0, 4)).toBe(0);
    expect(growthShare(0, 0)).toBe(0);
  });

  it("ranks a rising multi-show topic above a fading one", () => {
    const rising = topicScore({ distinctPodcasts: 4, episodesThisWeek: 6, episodesPrevWeek: 2, daysSinceLast: 1, confidence: 0.9 }, weights("topic")).score;
    const fading = topicScore({ distinctPodcasts: 4, episodesThisWeek: 2, episodesPrevWeek: 6, daysSinceLast: 1, confidence: 0.9 }, weights("topic")).score;
    expect(rising).toBeGreaterThan(fading);
  });
});

describe("sponsor score", () => {
  it("is 0 for a brand with no disclosed sponsorships, however often it is promoted", () => {
    const r = sponsorScore({ confirmedOccurrences: 0, distinctConfirmedPodcasts: 0, daysSinceLastConfirmed: null, confidence: 0 }, weights("sponsor"));
    expect(r.score).toBe(0);
  });

  it("rewards disclosed sponsorships across several shows", () => {
    const one = sponsorScore({ confirmedOccurrences: 3, distinctConfirmedPodcasts: 1, daysSinceLastConfirmed: 3, confidence: 0.9 }, weights("sponsor")).score;
    const many = sponsorScore({ confirmedOccurrences: 3, distinctConfirmedPodcasts: 3, daysSinceLastConfirmed: 3, confidence: 0.9 }, weights("sponsor")).score;
    expect(many).toBeGreaterThan(one);
  });
});

describe("outreach tiers and recency", () => {
  it("never calls a link-only promo a confirmed sponsor", () => {
    expect(outreachTier({ confirmedPodcasts: 0, confirmedEpisodes: 0, platformFlaggedEpisodes: 0, promoEpisodes: 5 })).toBe("C");
  });
  it("tiers disclosed sponsors by reach", () => {
    expect(outreachTier({ confirmedPodcasts: 2, confirmedEpisodes: 3, platformFlaggedEpisodes: 0, promoEpisodes: 0 })).toBe("A");
    expect(outreachTier({ confirmedPodcasts: 1, confirmedEpisodes: 1, platformFlaggedEpisodes: 0, promoEpisodes: 0 })).toBe("B");
    expect(outreachTier({ confirmedPodcasts: 0, confirmedEpisodes: 0, platformFlaggedEpisodes: 2, promoEpisodes: 2 })).toBe("B");
  });
  it("recency falls linearly and is zero when unknown", () => {
    expect(recency(0, 30)).toBe(1);
    expect(recency(15, 30)).toBe(0.5);
    expect(recency(60, 30)).toBe(0);
    expect(recency(null, 30)).toBe(0);
  });
});
