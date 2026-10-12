import { normalize } from "@/nlp/verify";

export type Counts = { tp: number; fp: number; fn: number };
export const emptyCounts = (): Counts => ({ tp: 0, fp: 0, fn: 0 });

export function prf(c: Counts) {
  const precision = c.tp + c.fp === 0 ? 1 : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? 1 : c.tp / (c.tp + c.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

const HONORIFICS = new Set(["dr", "prof", "professor", "mr", "mrs", "ms", "shri", "sir", "smt"]);

function nameTokens(name: string): string[] {
  return normalize(name)
    .split(" ")
    .filter((t) => t && !HONORIFICS.has(t));
}

/** "Professor Jiang Xueqin" matches "Jiang Xueqin"; two different people never match. */
export function sameName(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t) => long.includes(t));
}

export function sameBrand(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  return na.length > 0 && nb.length > 0 && (na === nb || na.includes(nb) || nb.includes(na));
}

/** Greedy one-to-one matching of predicted items against gold items. */
export function matchItems<P, G>(pred: P[], gold: G[], same: (p: P, g: G) => boolean) {
  const usedGold = new Set<number>();
  const pairs: { p: P; g: G }[] = [];
  const extra: P[] = [];
  for (const p of pred) {
    const gi = gold.findIndex((g, i) => !usedGold.has(i) && same(p, g));
    if (gi >= 0) {
      usedGold.add(gi);
      pairs.push({ p, g: gold[gi] });
    } else extra.push(p);
  }
  const missed = gold.filter((_, i) => !usedGold.has(i));
  return { pairs, extra, missed };
}

export function addMatch(c: Counts, m: { pairs: unknown[]; extra: unknown[]; missed: unknown[] }) {
  c.tp += m.pairs.length;
  c.fp += m.extra.length;
  c.fn += m.missed.length;
}
