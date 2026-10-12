import { normalize } from "@/nlp/verify";
import type { ResearchConfig } from "./config";

export type FocusConfig = Pick<
  ResearchConfig,
  "categories" | "keywords" | "founders" | "companies" | "products" | "excludedTopics" | "excludedKeywords" | "priorityTopics" | "priorityPodcastIds"
>;

/** True when the whole phrase appears in the text as separate words ("ai agents" in "Building AI agents at scale"). */
export function containsTerm(text: string, term: string): boolean {
  const t = normalize(term);
  if (!t) return false;
  return ` ${normalize(text)} `.includes(` ${t} `);
}

export function matchedInterests(text: string, c: FocusConfig): string[] {
  const all = [...c.keywords, ...c.founders, ...c.companies, ...c.products];
  const hits = all.filter((term) => containsTerm(text, term));
  return [...new Set(hits.map((h) => h.trim()))];
}

export function hasExcludedKeyword(text: string, c: FocusConfig): boolean {
  return c.excludedKeywords.some((term) => containsTerm(text, term));
}

export type EpisodeFocus = {
  excluded: boolean;
  matches: string[]; // interest terms found in the text
  preferredTopics: string[]; // the episode's topics that the founder cares about
  onPriorityShow: boolean;
  isMatch: boolean;
};

/**
 * How one monitored episode relates to the founder's preferences.
 * Excluded: the text hits an excluded keyword, or every topic the episode has is an excluded topic.
 */
export function episodeFocus(ep: { title: string; description?: string | null; topics: string[]; podcastId: number }, c: FocusConfig): EpisodeFocus {
  const text = `${ep.title} ${ep.description ?? ""}`;
  const allTopicsExcluded = ep.topics.length > 0 && ep.topics.every((t) => (c.excludedTopics as string[]).includes(t));
  const excluded = hasExcludedKeyword(ep.title, c) || allTopicsExcluded;
  const matches = matchedInterests(text, c);
  const wanted = new Set<string>([...c.categories, ...c.priorityTopics]);
  const preferredTopics = ep.topics.filter((t) => wanted.has(t));
  const onPriorityShow = c.priorityPodcastIds.includes(ep.podcastId);
  return { excluded, matches, preferredTopics, onPriorityShow, isMatch: !excluded && (matches.length > 0 || preferredTopics.length > 0 || onPriorityShow) };
}

export function guestMatchesFocus(g: { name: string; company?: string | null }, c: FocusConfig): boolean {
  return c.founders.some((f) => containsTerm(g.name, f) || containsTerm(f, g.name)) || (!!g.company && c.companies.some((co) => containsTerm(g.company!, co)));
}

export function brandMatchesFocus(b: { name: string; category?: string | null }, c: FocusConfig): boolean {
  return [...c.companies, ...c.products].some((t) => containsTerm(b.name, t) || containsTerm(t, b.name)) || (!!b.category && c.keywords.some((k) => containsTerm(b.category!, k)));
}

/** A topic the founder did not ask for and did not exclude: candidate for an "unexpected trend". */
export function isUnexpectedTopic(topic: string, c: FocusConfig): boolean {
  const wanted = new Set<string>([...c.categories, ...c.priorityTopics]);
  return !wanted.has(topic) && !(c.excludedTopics as string[]).includes(topic);
}
