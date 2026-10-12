import { z } from "zod";
import { TOPICS } from "@/nlp/taxonomy";

// The founder's research preferences. Stored in Neon as versioned JSON and read by every job at run time,
// so changing them takes effect on the next run with no redeploy.

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "mr", label: "Marathi" },
  { code: "bn", label: "Bengali" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "gu", label: "Gujarati" },
] as const;

export const MARKETS = [
  { code: "IN", label: "India" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "SG", label: "Singapore" },
  { code: "AE", label: "UAE" },
  { code: "AU", label: "Australia" },
  { code: "CA", label: "Canada" },
] as const;

export const FREQUENCIES = [
  { value: "daily", label: "Every day", minHours: 20 },
  { value: "every2days", label: "Every 2 days", minHours: 44 },
  { value: "weekly", label: "Once a week", minHours: 164 },
] as const;
export type Frequency = (typeof FREQUENCIES)[number]["value"];

const terms = z.array(z.string().trim().min(1).max(80)).max(50);

export const researchConfigSchema = z
  .object({
    modes: z.object({ focused: z.object({ enabled: z.boolean() }), discovery: z.object({ enabled: z.boolean() }) }),
    // How research effort (and the discovery API budget) is split between the two modes. Must total 100.
    effort: z.object({ focused: z.number().int().min(0).max(100), discovery: z.number().int().min(0).max(100) }),
    categories: z.array(z.enum(TOPICS)).max(20),
    keywords: terms,
    founders: terms,
    companies: terms,
    products: terms,
    excludedTopics: z.array(z.enum(TOPICS)).max(20),
    excludedKeywords: terms,
    priorityTopics: z.array(z.enum(TOPICS)).max(20),
    priorityPodcastIds: z.array(z.number().int().positive()).max(50),
    languages: z.array(z.string().min(2).max(8)).max(12),
    markets: z.array(z.string().length(2)).max(10),
    dateRangeDays: z.number().int().min(7).max(365),
    frequency: z.object({
      focused: z.enum(["daily", "every2days", "weekly"]),
      discovery: z.enum(["daily", "every2days", "weekly"]),
    }),
    // YouTube Data API units the research jobs may spend per day (the free daily quota is 10,000).
    quotaBudgetUnits: z.number().int().min(0).max(8000),
  })
  .refine((c) => c.effort.focused + c.effort.discovery === 100, { message: "Research effort must add up to 100%", path: ["effort"] });

export type ResearchConfig = z.infer<typeof researchConfigSchema>;

export const DEFAULT_CONFIG: ResearchConfig = {
  modes: { focused: { enabled: true }, discovery: { enabled: true } },
  effort: { focused: 70, discovery: 30 },
  categories: ["Entrepreneurship", "Startup Funding", "Venture Capital", "Artificial Intelligence"],
  keywords: ["AI agents", "Indian startup ecosystem"],
  founders: [],
  companies: [],
  products: [],
  excludedTopics: [],
  excludedKeywords: [],
  priorityTopics: ["Artificial Intelligence", "Venture Capital"],
  priorityPodcastIds: [],
  languages: ["en", "hi"],
  markets: ["IN"],
  dateRangeDays: 90,
  frequency: { focused: "daily", discovery: "weekly" },
  quotaBudgetUnits: 3000,
};

/** Merge a stored config over the defaults, so a config saved before a field existed still loads. */
export function parseConfig(stored: unknown): ResearchConfig {
  const merged = { ...DEFAULT_CONFIG, ...(typeof stored === "object" && stored ? stored : {}) };
  const result = researchConfigSchema.safeParse(merged);
  return result.success ? result.data : DEFAULT_CONFIG;
}

/** What the effort split means in practice for one run. Discovery spends nothing when it is switched off. */
export function effortBudget(c: ResearchConfig) {
  const d = c.modes.discovery.enabled ? c.effort.discovery : 0;
  return {
    discoveryYoutubeUnits: Math.floor((c.quotaBudgetUnits * d) / 100),
    focusedYoutubeUnits: Math.floor((c.quotaBudgetUnits * (c.modes.focused.enabled ? c.effort.focused : 0)) / 100),
    maxSearchTerms: d === 0 ? 0 : Math.max(1, Math.ceil(d / 10)),
    maxFeedsToFetch: Math.ceil(d * 0.6),
    maxEpisodesToAnalyze: d,
  };
}

/** Is a job due, given how often it should run and when it last ran? Tolerates cron timing jitter. */
export function isDue(frequency: Frequency, lastRunAt: Date | null, now = new Date()): boolean {
  if (!lastRunAt) return true;
  const minHours = FREQUENCIES.find((f) => f.value === frequency)!.minHours;
  return (now.getTime() - lastRunAt.getTime()) / 3_600_000 >= minHours;
}

/** Split a pasted block ("a, b\nc") into clean, de-duplicated terms. */
export function splitTerms(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
