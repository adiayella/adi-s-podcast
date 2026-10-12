import { describe, expect, it } from "vitest";
import { topicTrend } from "./trend";

describe("topic trend rubric", () => {
  it("does not call 1 -> 2 episodes a trend (the old rule said +100% rising)", () => {
    const t = topicTrend({ weeks: [2, 1, 1, 1, 1], showsThisWeek: 2, confidence: 0.9 });
    expect(t.label).toBe("steady");
    expect(t.gates.find((g) => g.key === "volume")!.met).toBe(false);
  });

  it("calls a broad, sustained lift above the 4-week normal rising", () => {
    const t = topicTrend({ weeks: [6, 4, 2, 2, 2], showsThisWeek: 3, confidence: 0.8 });
    expect(t.label).toBe("rising");
    expect(t.baseline).toBe(2.5);
    expect(t.gates.every((g) => g.met)).toBe(true);
    expect(t.score).toBeGreaterThan(50);
  });

  it("does not let one show's burst make a trend", () => {
    expect(topicTrend({ weeks: [7, 3, 1, 1, 1], showsThisWeek: 1, confidence: 0.9 }).label).toBe("steady");
  });

  it("does not let a one-week blip make a trend", () => {
    // Big week, but the week before was far below normal: the fortnight is not above a normal fortnight.
    const t = topicTrend({ weeks: [5, 0, 4, 4, 4], showsThisWeek: 3, confidence: 0.9 });
    expect(t.gates.find((g) => g.key === "sustained")!.met).toBe(false);
    expect(t.label).toBe("steady");
  });

  it("needs reliable tagging", () => {
    expect(topicTrend({ weeks: [6, 4, 2, 2, 2], showsThisWeek: 3, confidence: 0.3 }).label).toBe("steady");
  });

  it("labels a topic that appears from almost nothing across shows as new", () => {
    const t = topicTrend({ weeks: [3, 1, 0, 0, 0], showsThisWeek: 2, confidence: 0.7 });
    expect(t.label).toBe("new");
    expect(t.momentumPct).toBeNull();
  });

  it("labels a clear drop from an established level as falling", () => {
    expect(topicTrend({ weeks: [1, 3, 4, 3, 4], showsThisWeek: 1, confidence: 0.8 }).label).toBe("falling");
    // a small topic drifting from 1 to 0 is not "falling"
    expect(topicTrend({ weeks: [0, 1, 1, 1, 1], showsThisWeek: 0, confidence: 0.8 }).label).toBe("steady");
  });

  it("measures momentum against the 4-week normal", () => {
    expect(topicTrend({ weeks: [6, 4, 4, 4, 4], showsThisWeek: 3, confidence: 0.8 }).momentumPct).toBe(50);
  });
});
