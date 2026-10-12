import { describe, expect, it } from "vitest";
import { grounded } from "./brief-narrative";

const stats = JSON.stringify({ score: 82.2, episodes: 7, at: "2026-10-12T00:34:28.717Z", n: 4 });

describe("number grounding for AI commentary", () => {
  it("accepts numbers that are in the stats", () => {
    expect(grounded("7 episodes this week, score 82.2", stats)).toBe(true);
  });
  it("rejects an invented statistic even if its digits appear inside another number", () => {
    expect(grounded("playbooks fail 90% of startups", JSON.stringify({ at: "2026-10-12T00:34:28.717Z", id: 1090 }))).toBe(false);
  });
  it("accepts text with no numbers", () => {
    expect(grounded("Pitch direct brand integration", stats)).toBe(true);
  });
});
