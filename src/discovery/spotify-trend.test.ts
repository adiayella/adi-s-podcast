import { describe, expect, it } from "vitest";
import { bestShowByName, dice, inSector, matchEpisode, scoreShow, sectorHeat } from "./spotify-trend";

const NOW = new Date("2026-10-12T06:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const ep = (title: string, d: number, description = "") => ({ title, description, publishedAt: daysAgo(d), url: `https://open.spotify.com/episode/${d}` });

describe("episode matching", () => {
  const spotify = [ep("Memory Explained: Why We Forget | Nikolay Kukushkin | FO571", 6), ep("Neuroscientist's Guide To Focus | Dr Sahar Yousef | FO559", 34)];

  it("matches the same title released within 3 days", () => {
    expect(matchEpisode({ title: "Memory Explained: Why We Forget | Nikolay Kukushkin | FO571", publishedAt: daysAgo(5) }, spotify)?.url).toBe(spotify[0].url);
  });

  it("rejects a same-title episode released too far apart", () => {
    expect(matchEpisode({ title: "Memory Explained: Why We Forget | Nikolay Kukushkin | FO571", publishedAt: daysAgo(20) }, spotify)).toBeNull();
  });

  it("does not let a short title match a longer one by containment", () => {
    expect(dice("Memory", "Memory Explained: Why We Forget | Nikolay Kukushkin")).toBeLessThan(0.8);
    expect(matchEpisode({ title: "Memory", publishedAt: daysAgo(6) }, spotify)).toBeNull();
  });

  it("refuses to pick between two equally good candidates", () => {
    const twins = [ep("Weekly market wrap", 2), { ...ep("Weekly market wrap", 3), url: "x" }];
    expect(matchEpisode({ title: "Weekly market wrap", publishedAt: daysAgo(2) }, twins)).toBeNull();
  });

  it("finds a show whose language tag is written differently", () => {
    const shows = [{ name: "The Ranveer Show हिंदी" }, { name: "BeerBiceps" }, { name: "The Ranveer Show Clips Hindi" }];
    expect(bestShowByName("The Ranveer Show (Hindi)", shows)?.name).toBe("The Ranveer Show हिंदी");
    expect(bestShowByName("Some Unrelated Podcast", shows)).toBeNull();
  });
});

describe("sector keywords", () => {
  it("matches whole words only", () => {
    expect(inSector("Fintech", "How UPI changed payments")).toBe(true);
    expect(inSector("Artificial Intelligence", "The AI agents are coming")).toBe(true);
    expect(inSector("Artificial Intelligence", "Said the chairman")).toBe(false); // "ai" inside a word does not count
    expect(inSector("Quick Commerce", "Inside Zepto's dark store")).toBe(true);
  });
});

describe("Spotify trend rubric", () => {
  // Weekly fintech show, busier this month than last.
  const steady = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 33, 40, 47, 54, 61, 68, 75, 82].map((d) => ep(`Fintech episode ${d} on UPI payments`, d));

  it("scores every component from real numbers and explains each", () => {
    const t = scoreShow({ sector: "Fintech", rank: 1, episodes: steady, totalEpisodes: 120, earlierTotals: [110], now: NOW });
    expect(t.components.map((c) => c.key)).toEqual(["sectorActivity", "momentum", "consistency", "visibility", "catalogueGrowth"]);
    expect(t.metrics.sectorEpisodes30d).toBe(10);
    expect(t.components.find((c) => c.key === "visibility")!.points).toBe(15);
    expect(t.components.find((c) => c.key === "catalogueGrowth")!.points).toBe(10);
    expect(t.score).toBe(t.components.reduce((a, c) => a + c.points, 0));
    expect(t.label).toBe("hot");
    expect(t.sampleEpisodes.length).toBe(3);
  });

  it("gives no catalogue growth on the first check", () => {
    const t = scoreShow({ sector: "Fintech", rank: 10, episodes: steady, totalEpisodes: 120, earlierTotals: [], now: NOW });
    expect(t.components.find((c) => c.key === "catalogueGrowth")!.points).toBe(0);
    expect(t.components.find((c) => c.key === "visibility")!.points).toBe(1.5);
  });

  it("labels a show with no sector episodes as off-topic, whatever its activity", () => {
    const football = steady.map((e, i) => ({ ...e, title: `Matchday ${i} review` }));
    expect(scoreShow({ sector: "Fintech", rank: 3, episodes: football, totalEpisodes: 300, earlierTotals: [290], now: NOW }).label).toBe("off-topic");
  });

  it("cannot call a show hot on a high score from search rank and cadence alone", () => {
    // Steady and top-ranked, but only one sector episode and no growth: two independent signals are missing.
    const eps = steady.map((e, i) => ({ ...e, title: i === 0 ? "UPI payments explained" : `Conversation ${i}` }));
    const t = scoreShow({ sector: "Fintech", rank: 1, episodes: eps, totalEpisodes: 100, earlierTotals: [100], now: NOW });
    expect(t.label).not.toBe("hot");
  });
});

describe("sector heat", () => {
  it("compares sector episodes now vs the month before and ignores off-topic shows", () => {
    const h = sectorHeat([
      { score: 60, label: "rising", sectorEpisodes30d: 6, sectorEpisodesPrev30d: 3 },
      { score: 40, label: "steady", sectorEpisodes30d: 2, sectorEpisodesPrev30d: 2 },
      { score: 50, label: "off-topic", sectorEpisodes30d: 0, sectorEpisodesPrev30d: 0 },
    ]);
    expect(h).toMatchObject({ label: "heating up", episodes30d: 8, episodesPrev30d: 5, hotOrRising: 1, medianScore: 50 });
  });

  it("says too little data instead of guessing", () => {
    expect(sectorHeat([{ score: 20, label: "quiet", sectorEpisodes30d: 1, sectorEpisodesPrev30d: 1 }]).label).toBe("too little data");
  });
});
