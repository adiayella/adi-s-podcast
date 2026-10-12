import { normalize } from "@/nlp/verify";
import { TOPICS, type Topic } from "@/nlp/taxonomy";
import { publishingMetrics, type PublishingMetrics } from "./evaluate";

// Pure logic for Spotify episode matching and the Spotify trend rubric. No database, no network, no AI.
// Spotify Content is never sent to Gemini (Spotify Developer Terms IV.2.1.1), so sector membership here
// is decided by plain keyword rules on titles and descriptions, which anyone can audit.

const DAY = 86_400_000;
const STOP = new Set(["the", "a", "an", "of", "and", "with", "to", "in", "on", "for", "is", "by", "ft", "feat", "ep", "episode", "podcast", "show"]);

const tokens = (s: string) => new Set(normalize(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t)));

/** Dice coefficient on title words: 1 = same words. Stricter than an overlap score, so a short title cannot match a long one by being contained in it. */
export function dice(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

export type DatedTitle = { title: string; publishedAt: Date };

/**
 * The Spotify episode that is the same as ours: near-identical title AND released within 3 days of it.
 * When two qualify about equally, nothing is returned rather than guessing.
 */
export function matchEpisode<T extends DatedTitle>(ep: DatedTitle, candidates: T[]): T | null {
  const scored = candidates
    .filter((c) => Math.abs(c.publishedAt.getTime() - ep.publishedAt.getTime()) <= 3 * DAY)
    .map((c) => ({ c, s: dice(ep.title, c.title) }))
    .filter((x) => x.s >= 0.8)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].s - scored[1].s < 0.05) return null;
  return scored[0].c;
}

/** The Spotify show for a podcast we already monitor: a close name match, confirmed later by matching episodes. */
// Language tags are written differently across platforms ("(Hindi)" in the feed, "हिंदी" on Spotify), so they are ignored.
const showCore = (s: string) => s.replace(/\([^)]*\)/g, " ").replace(/\b(hindi|english|tamil|telugu|marathi)\b|हिंदी|हिन्दी/gi, " ");

export function bestShowByName<T extends { name: string }>(name: string, shows: T[]): T | null {
  const best = shows.map((s) => ({ s, d: dice(showCore(name), showCore(s.name)) })).sort((a, b) => b.d - a.d)[0];
  return best && best.d >= 0.7 ? best.s : null;
}

// ---------------------------------------------------------------- sectors ("fields")
// What we type into Spotify search for each sector, and the words that make an episode count for it.
// Keywords are matched as whole words (or phrases) in the episode title and description.
export const SECTOR_SEARCH: Record<Topic, { query: string; keywords: string[] }> = {
  "Artificial Intelligence": { query: "artificial intelligence india", keywords: ["ai", "artificial intelligence", "genai", "llm", "chatgpt", "machine learning", "agents", "openai"] },
  Entrepreneurship: { query: "entrepreneurship india founders", keywords: ["founder", "founders", "entrepreneur", "entrepreneurship", "startup", "business"] },
  "Startup Funding": { query: "startup funding india", keywords: ["funding", "raise", "raised", "seed round", "series a", "series b", "fundraise", "fundraising", "valuation"] },
  "Venture Capital": { query: "venture capital india", keywords: ["venture capital", "vc", "vcs", "investor", "investors", "fund manager", "limited partners"] },
  "Quick Commerce": { query: "quick commerce india", keywords: ["quick commerce", "q-commerce", "zepto", "blinkit", "instamart", "10 minute delivery", "dark store"] },
  "E-commerce": { query: "ecommerce india", keywords: ["ecommerce", "e-commerce", "online retail", "flipkart", "amazon", "meesho", "marketplace"] },
  "D2C & Consumer Brands": { query: "d2c brands india", keywords: ["d2c", "dtc", "consumer brand", "consumer brands", "fmcg", "brand building"] },
  Fintech: { query: "fintech india", keywords: ["fintech", "upi", "payments", "lending", "neobank", "nbfc", "credit card", "insurtech"] },
  "Stock Markets & Investing": { query: "stock market india investing", keywords: ["stock market", "stocks", "sensex", "nifty", "ipo", "mutual fund", "mutual funds", "trading", "investing"] },
  "Economy & Policy": { query: "indian economy policy", keywords: ["economy", "gdp", "inflation", "budget", "rbi", "policy", "tariff", "tariffs", "regulation"] },
  Leadership: { query: "leadership india ceo", keywords: ["leadership", "leader", "leaders", "ceo", "management", "culture"] },
  Technology: { query: "technology india tech", keywords: ["technology", "tech", "software", "semiconductor", "chips", "deeptech", "deep tech"] },
  "SaaS & B2B": { query: "saas b2b india", keywords: ["saas", "b2b", "enterprise software", "arr", "go to market", "gtm"] },
  "Creator Economy & Media": { query: "creator economy india", keywords: ["creator", "creators", "youtuber", "influencer", "content creation", "creator economy", "media"] },
  "Marketing & Growth": { query: "marketing growth india", keywords: ["marketing", "growth", "branding", "advertising", "performance marketing", "seo"] },
  "Careers & Hiring": { query: "careers jobs india", keywords: ["career", "careers", "hiring", "jobs", "job", "layoffs", "resume", "interview tips"] },
  "Health & Wellness": { query: "health wellness india", keywords: ["health", "wellness", "fitness", "nutrition", "sleep", "mental health", "longevity"] },
  "Real Estate": { query: "real estate india", keywords: ["real estate", "property", "housing", "home loan", "realty"] },
  "Geopolitics & Energy": { query: "geopolitics india", keywords: ["geopolitics", "china", "war", "oil", "energy", "defence", "defense", "trade war"] },
  "Personal Finance": { query: "personal finance india", keywords: ["personal finance", "money", "savings", "tax", "retirement", "sip", "financial freedom", "wealth"] },
};

const keywordPatterns = new Map(
  TOPICS.map((t) => [t, SECTOR_SEARCH[t].keywords.map((k) => new RegExp(`(^| )${normalize(k)}( |$)`))]),
);

/** Does this episode text belong to the sector? Whole-word keyword match on normalised text. */
export function inSector(sector: Topic, text: string): boolean {
  const t = normalize(text);
  return keywordPatterns.get(sector)!.some((re) => re.test(t));
}

// ---------------------------------------------------------------- the rubric
export const SPOTIFY_TREND_RUBRIC = {
  version: "spotify-trend-v1",
  components: [
    { key: "sectorActivity", label: "Sector activity", max: 30, rule: "Episodes on this sector in the last 30 days: 4 or more = full marks, scaled below that." },
    { key: "momentum", label: "Momentum", max: 25, rule: "All episodes, last 30 days vs the 30 before: up 25%+ from a base of 2+ = 25; new burst (3+ now, under 2 before) = 15; flat = 10; down = 0." },
    { key: "consistency", label: "Consistency", max: 20, rule: "Steady cadence over 90 days (same rule as discovery) = 20; at least 3 episodes in 90 days = 10; else 0." },
    { key: "visibility", label: "Spotify search rank", max: 15, rule: "Position in Spotify's own results for the sector search in India: #1 = 15, falling by 1.5 per place to #10 = 1.5." },
    { key: "catalogueGrowth", label: "Catalogue growth", max: 10, rule: "Spotify's total episode count rose since our first check in the last 30 days = 10. Needs two checks." },
  ],
  labels: [
    { label: "hot", min: 70, rule: "70+ and at least two of: sector activity 2+ episodes, momentum up, catalogue growing" },
    { label: "rising", min: 50, rule: "50-69" },
    { label: "steady", min: 30, rule: "30-49" },
    { label: "quiet", min: 0, rule: "under 30" },
    { label: "off-topic", min: 0, rule: "no episode on this sector in 90 days: Spotify returned it, but it is left out of the sector heat" },
  ],
  notAvailable: "Spotify's API does not expose plays, followers, ratings or likes for podcasts, so none of these are used. Likes and views shown come from YouTube when the show is one we already track.",
} as const;

export type TrendLabel = "hot" | "rising" | "steady" | "quiet" | "off-topic";

export type ShowTrendInput = {
  sector: Topic;
  rank: number; // 1-based position in Spotify's search results
  episodes: { title: string; description: string; publishedAt: Date; url: string }[];
  totalEpisodes: number;
  earlierTotals: number[]; // total_episodes from earlier checks in the last 30 days, oldest first
  now?: Date;
};

export type ShowTrend = {
  score: number;
  label: TrendLabel;
  components: { key: string; label: string; points: number; max: number; detail: string }[];
  metrics: PublishingMetrics & { sectorEpisodes30d: number; sectorEpisodesPrev30d: number; sectorShare90d: number };
  sampleEpisodes: { title: string; url: string; date: string }[];
};

export function scoreShow(input: ShowTrendInput): ShowTrend {
  const now = input.now ?? new Date();
  const age = (d: Date) => (now.getTime() - d.getTime()) / DAY;
  const m = publishingMetrics(input.episodes, now);
  const sectorEps = input.episodes.filter((e) => inSector(input.sector, `${e.title} ${e.description}`));
  const s30 = sectorEps.filter((e) => age(e.publishedAt) < 30).length;
  const sPrev = sectorEps.filter((e) => age(e.publishedAt) >= 30 && age(e.publishedAt) < 60).length;
  const s90 = sectorEps.filter((e) => age(e.publishedAt) < 90).length;
  const share = m.episodes90d ? s90 / m.episodes90d : 0;

  const activity = Math.round(30 * Math.min(s30 / 4, 1) * 10) / 10;
  const up = m.episodesPrev30d >= 2 && m.episodes30d >= m.episodesPrev30d * 1.25;
  const burst = m.episodesPrev30d < 2 && m.episodes30d >= 3;
  const momentum = up ? 25 : burst ? 15 : m.episodes30d > 0 && m.episodes30d >= m.episodesPrev30d ? 10 : 0;
  const consistency = m.regular ? 20 : m.episodes90d >= 3 ? 10 : 0;
  const visibility = Math.max(0, Math.round(15 * ((11 - input.rank) / 10) * 10) / 10);
  const first = input.earlierTotals[0];
  const grew = first !== undefined && input.totalEpisodes > first;
  const growth = grew ? 10 : 0;

  const score = Math.round((activity + momentum + consistency + visibility + growth) * 10) / 10;
  const independent = [s30 >= 2, up || burst, grew].filter(Boolean).length;
  const label: TrendLabel = s90 === 0 ? "off-topic" : score >= 70 && independent >= 2 ? "hot" : score >= 50 ? "rising" : score >= 30 ? "steady" : "quiet";

  return {
    score,
    label,
    components: [
      { key: "sectorActivity", label: "Sector activity", points: activity, max: 30, detail: `${s30} sector episodes in the last 30 days (${sPrev} in the 30 before)` },
      { key: "momentum", label: "Momentum", points: momentum, max: 25, detail: `${m.episodes30d} episodes in the last 30 days vs ${m.episodesPrev30d} before` },
      { key: "consistency", label: "Consistency", points: consistency, max: 20, detail: m.avgGapDays === null ? "too few episodes to judge" : `about every ${m.avgGapDays.toFixed(1)} days${m.regular ? ", steady" : ", irregular"}` },
      { key: "visibility", label: "Spotify search rank", points: visibility, max: 15, detail: `#${input.rank} for this sector on Spotify (India)` },
      { key: "catalogueGrowth", label: "Catalogue growth", points: growth, max: 10, detail: first === undefined ? "first check; needs a second one" : `${first} → ${input.totalEpisodes} episodes on Spotify` },
    ],
    metrics: { ...m, sectorEpisodes30d: s30, sectorEpisodesPrev30d: sPrev, sectorShare90d: Math.round(share * 100) / 100 },
    sampleEpisodes: sectorEps
      .filter((e) => age(e.publishedAt) < 90)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, 3)
      .map((e) => ({ title: e.title, url: e.url, date: e.publishedAt.toISOString().slice(0, 10) })),
  };
}

export type SectorHeat = { label: "heating up" | "steady" | "cooling" | "too little data"; episodes30d: number; episodesPrev30d: number; hotOrRising: number; medianScore: number | null };

/** A sector's temperature from the shows Spotify returned for it: sector episodes now vs the month before. */
export function sectorHeat(all: { score: number; label: TrendLabel; sectorEpisodes30d: number; sectorEpisodesPrev30d: number }[]): SectorHeat {
  const shows = all.filter((s) => s.label !== "off-topic");
  const now = shows.reduce((a, s) => a + s.sectorEpisodes30d, 0);
  const prev = shows.reduce((a, s) => a + s.sectorEpisodesPrev30d, 0);
  const scores = shows.map((s) => s.score).sort((a, b) => a - b);
  const mid = Math.floor(scores.length / 2);
  const medianScore = scores.length ? (scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2) : null;
  const hotOrRising = shows.filter((s) => s.label === "hot" || s.label === "rising").length;
  const label = now + prev < 5 ? "too little data" : prev > 0 && now >= prev * 1.25 ? "heating up" : now <= prev * 0.8 ? "cooling" : prev === 0 ? "heating up" : "steady";
  return { label, episodes30d: now, episodesPrev30d: prev, hotOrRising, medianScore };
}
