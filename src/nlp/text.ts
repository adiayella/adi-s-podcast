import { normalize } from "./verify";

const MAX_EXTRA_CHARS = 3000;

/**
 * Combine the RSS description with any lines that appear only in the YouTube description
 * (sponsor lines and links often differ between the two). The result is also the text that
 * evidence quotes are verified against, so the model can only quote what it was shown.
 */
export function mergeDescriptions(rss: string, youtube: string | null | undefined): string {
  if (!youtube) return rss;
  const known = normalize(rss);
  const extra = youtube
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3 && !known.includes(normalize(l)));
  if (!extra.length) return rss;
  return `${rss}\n\n[Additional lines from the YouTube description]\n${extra.join("\n").slice(0, MAX_EXTRA_CHARS)}`;
}
