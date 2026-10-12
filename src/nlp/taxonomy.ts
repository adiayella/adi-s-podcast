// Controlled topic vocabulary. A fixed list keeps counts meaningful: "AI" and "Artificial
// Intelligence" can never become two separate topics. Semantic grouping of fresher, finer-grained
// themes happens later with embeddings (Phase 5).
export const TOPICS = [
  "Artificial Intelligence",
  "Entrepreneurship",
  "Startup Funding",
  "Venture Capital",
  "Quick Commerce",
  "E-commerce",
  "D2C & Consumer Brands",
  "Fintech",
  "Stock Markets & Investing",
  "Economy & Policy",
  "Leadership",
  "Technology",
  "SaaS & B2B",
  "Creator Economy & Media",
  "Marketing & Growth",
  "Careers & Hiring",
  "Health & Wellness",
  "Real Estate",
  "Geopolitics & Energy",
  "Personal Finance",
] as const;

export type Topic = (typeof TOPICS)[number];

export const EPISODE_TYPES = ["interview", "solo", "news_briefing", "panel", "other"] as const;
export type EpisodeType = (typeof EPISODE_TYPES)[number];

export const GUEST_CATEGORIES = ["founder", "executive", "investor", "creator", "expert", "journalist", "other"] as const;
export type GuestCategory = (typeof GUEST_CATEGORIES)[number];

export const SPONSOR_CLASSES = [
  "explicit_sponsor",
  "paid_promotion",
  "possible_affiliate",
  "organic_mention",
  "unknown",
] as const;
export type SponsorClass = (typeof SPONSOR_CLASSES)[number];

// Bump when the prompt or schema changes; episodes can then be re-analysed deliberately.
export const PROMPT_VERSION = "v3";
