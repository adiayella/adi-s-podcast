import { normalize } from "@/nlp/verify";

// The words of a search query worth matching on: no filler words, plurals reduced to their stem.
const STOP = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "about", "with", "what", "who", "how", "is", "are", "do", "does", "india", "indian", "podcast", "podcasts", "episode", "episodes"]);

export function queryWords(q: string): string[] {
  // A plural becomes its stem, so "sports" also finds "sport" and "sportswear".
  const stem = (w: string) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  return [...new Set(normalize(q).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)).map(stem))].slice(0, 6);
}
