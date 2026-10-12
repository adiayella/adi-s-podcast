import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, effortBudget, isDue, parseConfig, researchConfigSchema, splitTerms, type ResearchConfig } from "./config";
import { brandMatchesFocus, containsTerm, episodeFocus, guestMatchesFocus, isUnexpectedTopic } from "./focus";

const cfg = (over: Partial<ResearchConfig> = {}): ResearchConfig => ({ ...DEFAULT_CONFIG, ...over });

describe("research preferences", () => {
  it("accepts the defaults", () => {
    expect(researchConfigSchema.safeParse(DEFAULT_CONFIG).success).toBe(true);
  });

  it("rejects an effort split that does not total 100", () => {
    const r = researchConfigSchema.safeParse(cfg({ effort: { focused: 80, discovery: 30 } }));
    expect(r.success).toBe(false);
  });

  it("rejects an unknown category and an out-of-range date range", () => {
    expect(researchConfigSchema.safeParse({ ...DEFAULT_CONFIG, categories: ["Cooking"] }).success).toBe(false);
    expect(researchConfigSchema.safeParse(cfg({ dateRangeDays: 3 })).success).toBe(false);
  });

  it("falls back to defaults for settings saved before a field existed", () => {
    const old = { ...DEFAULT_CONFIG } as Partial<ResearchConfig>;
    delete old.quotaBudgetUnits;
    expect(parseConfig(old).quotaBudgetUnits).toBe(DEFAULT_CONFIG.quotaBudgetUnits);
  });

  it("splits pasted terms and removes blanks and duplicates", () => {
    expect(splitTerms("AI agents, ai agents\n\nZepto; Cred ,")).toEqual(["AI agents", "Zepto", "Cred"]);
  });
});

describe("effort allocation", () => {
  it("gives discovery a budget proportional to its share", () => {
    const b = effortBudget(cfg({ effort: { focused: 70, discovery: 30 }, quotaBudgetUnits: 3000 }));
    expect(b.discoveryYoutubeUnits).toBe(900);
    expect(b.maxSearchTerms).toBe(3);
    expect(b.maxEpisodesToAnalyze).toBe(30);
  });

  it("spends nothing on discovery when the mode is switched off", () => {
    const b = effortBudget(cfg({ modes: { focused: { enabled: true }, discovery: { enabled: false } } }));
    expect(b.discoveryYoutubeUnits).toBe(0);
    expect(b.maxSearchTerms).toBe(0);
  });
});

describe("scheduling", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  it("runs when it has never run", () => expect(isDue("weekly", null, now)).toBe(true));
  it("a daily job is not due 3 hours after it last ran", () => expect(isDue("daily", new Date(now.getTime() - 3 * 3_600_000), now)).toBe(false));
  it("a daily job is due about a day later, despite cron jitter", () => expect(isDue("daily", new Date(now.getTime() - 23 * 3_600_000), now)).toBe(true));
  it("a weekly job is not due after 3 days but is after 7", () => {
    expect(isDue("weekly", new Date(now.getTime() - 3 * 86_400_000), now)).toBe(false);
    expect(isDue("weekly", new Date(now.getTime() - 7 * 86_400_000), now)).toBe(true);
  });
});

describe("focus matching", () => {
  const c = cfg({ keywords: ["AI agents"], founders: ["Nikhil Kamath"], companies: ["Zepto"], excludedKeywords: ["cricket"], excludedTopics: ["Real Estate"], priorityPodcastIds: [7] });

  it("matches whole phrases, not fragments", () => {
    expect(containsTerm("Building AI agents at scale", "ai agents")).toBe(true);
    expect(containsTerm("Maintaining agents", "ai agents")).toBe(false);
    expect(containsTerm("Raising capital", "ai")).toBe(false);
  });

  it("flags an episode that mentions a keyword or a preferred topic", () => {
    const f = episodeFocus({ title: "How AI agents change SaaS", topics: ["SaaS & B2B"], podcastId: 1 }, c);
    expect(f.isMatch).toBe(true);
    expect(f.matches).toContain("AI agents");
  });

  it("excludes an episode on an excluded keyword or only on excluded topics", () => {
    expect(episodeFocus({ title: "Cricket and business", topics: ["Leadership"], podcastId: 1 }, c).excluded).toBe(true);
    expect(episodeFocus({ title: "Flat prices", topics: ["Real Estate"], podcastId: 1 }, c).excluded).toBe(true);
    expect(episodeFocus({ title: "Flats and AI agents", topics: ["Real Estate", "Artificial Intelligence"], podcastId: 1 }, c).excluded).toBe(false);
  });

  it("treats a priority show as a match", () => {
    expect(episodeFocus({ title: "Random chat", topics: [], podcastId: 7 }, c).isMatch).toBe(true);
  });

  it("matches guests and brands the founder named", () => {
    expect(guestMatchesFocus({ name: "Nikhil Kamath" }, c)).toBe(true);
    expect(guestMatchesFocus({ name: "Someone", company: "Zepto Pvt Ltd" }, c)).toBe(true);
    expect(brandMatchesFocus({ name: "Zepto" }, c)).toBe(true);
    expect(brandMatchesFocus({ name: "Porter", category: "logistics" }, c)).toBe(false);
  });

  it("finds unexpected topics: not wanted, not excluded", () => {
    expect(isUnexpectedTopic("Health & Wellness", c)).toBe(true);
    expect(isUnexpectedTopic("Venture Capital", c)).toBe(false);
    expect(isUnexpectedTopic("Real Estate", c)).toBe(false);
  });
});
