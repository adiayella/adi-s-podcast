import { describe, expect, it } from "vitest";
import { buildBriefDoc, toHtml, toMarkdown } from "./brief-render";
import type { BriefStats, DiscoveryStats } from "./brief-stats";

const base: BriefStats = {
  weekStart: "2026-10-12",
  generatedAt: "2026-10-12T00:00:00Z",
  guests: [],
  guestEvidence: { windowDays: 30, guestsInWindow: 0, onMultipleShows: 0, sufficient: false },
  topics: [],
  sponsors: [],
  sponsorEvidence: { windowDays: 90, disclosedBrands: 0, promoBrands: 0, sufficient: false },
  health: { episodesLast7Days: 5, syncErrors: 0, failedAnalyses: 0, lastDailyRun: null, lastDailyStatus: null },
};

const focus = { settingsVersion: 3, universe: "10 monitored podcasts", interests: ["AI agents"], categories: [], excludedTopics: [], monitoredPodcasts: 10, matchedEpisodes: 4, excludedEpisodes: 1 };

const discovery = (over: Partial<DiscoveryStats> = {}): DiscoveryStats => ({
  enabled: true,
  universe: "Podcasts outside your watchlist, found by discovery research and awaiting your review",
  inQueue: 2,
  saved: 0,
  lastRunAt: "2026-10-11T00:00:00Z",
  candidates: [{ name: "New Show", relevance: 71, trend: "active", reason: "Covers AI agents.", language: "en", rssKnown: true, episodes: [{ title: "Ep 1", url: "https://example.com/1", at: "2026-10-10T00:00:00Z" }] }],
  themes: [],
  founders: [],
  sponsors: [],
  ...over,
});

describe("brief with two sections", () => {
  it("has separate Focused Intelligence and Discovery Opportunities groups, each naming its source", () => {
    const md = toMarkdown(buildBriefDoc({ ...base, focus, discovery: discovery() }, null));
    expect(md).toContain("# Focused Intelligence");
    expect(md).toContain("# Discovery Opportunities");
    expect(md).toContain("Source: 10 monitored podcasts");
    expect(md).toContain("NOT on your watchlist");
    expect(md.indexOf("# Focused Intelligence")).toBeLessThan(md.indexOf("# Discovery Opportunities"));
  });

  it("puts discovered podcasts only under the discovery group, never among the monitored sections", () => {
    const md = toMarkdown(buildBriefDoc({ ...base, focus, discovery: discovery() }, null));
    const focusedPart = md.slice(md.indexOf("# Focused Intelligence"), md.indexOf("# Discovery Opportunities"));
    expect(focusedPart).not.toContain("New Show");
    expect(md.slice(md.indexOf("# Discovery Opportunities"))).toContain("New Show");
  });

  it("says plainly when discovery is switched off, and lists no candidates", () => {
    const md = toMarkdown(buildBriefDoc({ ...base, focus, discovery: discovery({ enabled: false, candidates: [], universe: "Discovery is switched off" }) }, null));
    expect(md).toContain("switched off");
    expect(md).not.toContain("New Show");
  });

  it("says so honestly when discovery found nothing", () => {
    const md = toMarkdown(buildBriefDoc({ ...base, focus, discovery: discovery({ candidates: [] }) }, null));
    expect(md).toContain("Nothing is suggested without real evidence");
  });

  it("still renders a brief stored before research modes existed", () => {
    const md = toMarkdown(buildBriefDoc(base, null));
    expect(md).toContain("## Guest opportunities");
    expect(md).not.toContain("Discovery Opportunities");
  });
});

describe("analysis depth", () => {
  it("states how many episodes were analysed from a transcript", () => {
    const md = toMarkdown(buildBriefDoc({ ...base, coverage: { transcript: 18, total: 240, shows: 1 } }, null));
    expect(md).toContain("18 of 240 monitored episodes (8%) were analysed from a transcript");
  });
  it("omits the line for briefs stored before coverage existed", () => {
    expect(toMarkdown(buildBriefDoc(base, null))).not.toContain("Analysis depth");
  });
});

describe("email safety", () => {
  it("escapes untrusted discovered show names and quotes in the HTML email", () => {
    const evil = discovery({ candidates: [{ name: "<script>alert(1)</script>", relevance: 50, trend: "active", reason: "x \"quoted\" & <b>bold</b>", language: null, rssKnown: false, episodes: [] }] });
    const html = toHtml(buildBriefDoc({ ...base, focus, discovery: evil }, null));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>bold</b>");
  });

  it("drops links that are not http(s)", () => {
    const bad = discovery({ candidates: [{ name: "Show", relevance: 50, trend: "active", reason: "r", language: null, rssKnown: true, episodes: [{ title: "click me", url: "javascript:alert(1)", at: "2026-10-10T00:00:00Z" }] }] });
    const html = toHtml(buildBriefDoc({ ...base, focus, discovery: bad }, null));
    expect(html).not.toContain("javascript:");
  });
});

describe("reporting period", () => {
  const withPeriod: BriefStats = {
    ...base,
    weekStart: "2026-10-05",
    period: { label: "2026-10-05 to 2026-10-11", from: "2026-10-04T18:30:00.000Z", to: "2026-10-11T18:30:00.000Z", previousLabel: "2026-09-28 to 2026-10-04" },
    activity: { episodes: 18, previousEpisodes: 17, shows: 9, previousShows: 8, newGuests: 5, previousNewGuests: 0 },
  };
  it("names the completed week in the subject and compares it with the week before", () => {
    const doc = buildBriefDoc(withPeriod, null);
    expect(doc.subject).toBe("Monday brief: 5 Oct to 11 Oct 2026");
    const md = toMarkdown(doc);
    expect(md).toContain("Reporting period: 2026-10-05 to 2026-10-11");
    expect(md).toContain("compared with 2026-09-28 to 2026-10-04");
    expect(md).toContain("+6% vs 17");
  });
  it("states plainly when the data behind the brief was not fully fresh", () => {
    const md = toMarkdown(buildBriefDoc({ ...withPeriod, dataNotes: ["3 episode(s) are still waiting for analysis."] }, null));
    expect(md).toContain("Data note: 3 episode(s) are still waiting for analysis.");
  });
  it("does not divide by zero when the earlier week was empty", () => {
    const md = toMarkdown(buildBriefDoc({ ...withPeriod, activity: { ...withPeriod.activity!, previousEpisodes: 0 } }, null));
    expect(md).toContain("up from 0");
  });
});
