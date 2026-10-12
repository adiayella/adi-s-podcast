import { normalize } from "@/nlp/verify";

// Entity resolution: decide whether a name found in text refers to an entity we already know.
// Rule of thumb: a wrong merge corrupts every count built on it, a missed merge only costs a
// duplicate row. So we merge only when the evidence is clear and flag anything ambiguous.

const HONORIFICS = new Set(["dr", "prof", "professor", "mr", "mrs", "ms", "shri", "sir", "smt", "ca", "adv"]);

export function nameTokens(name: string): string[] {
  return normalize(name)
    .split(" ")
    .filter((t) => t && !HONORIFICS.has(t));
}

export function nameKey(name: string): string {
  return nameTokens(name).join(" ");
}

export type GuestCandidate = { id: number; aliases: string[]; company: string };
export type Decision =
  | { kind: "exact"; id: number }
  | { kind: "merge"; id: number }
  | { kind: "ambiguous"; ids: number[] }
  | { kind: "new" };

function companyCompatible(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return true; // unknown company is not a conflict
  return na === nb || na.includes(nb) || nb.includes(na);
}

// A single letter stands for any name that starts with it ("K" ~ "Kumar").
const tokenMatches = (a: string, b: string) =>
  a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));

// Every small token must match a DIFFERENT big token (one-to-one), and at least one must be a full-word match,
// so a stray initial can never stand in for a whole name.
function isSubset(small: string[], big: string[]): boolean {
  const used = new Set<number>();
  let full = 0;
  for (const t of small) {
    let idx = big.findIndex((b, i) => !used.has(i) && b === t);
    if (idx >= 0) full++;
    else idx = big.findIndex((b, i) => !used.has(i) && tokenMatches(t, b));
    if (idx < 0) return false;
    used.add(idx);
  }
  return full >= 1;
}

export function decideGuest(name: string, company: string, candidates: GuestCandidate[]): Decision {
  const key = nameKey(name);
  const exact = candidates.find((c) => c.aliases.some((a) => nameKey(a) === key));
  if (exact) return { kind: "exact", id: exact.id };

  const tokens = nameTokens(name);
  if (tokens.length < 2) return { kind: "new" }; // a single first name is never enough to merge

  const similar = candidates.filter((c) =>
    c.aliases.some((a) => {
      const at = nameTokens(a);
      if (at.length < 2) return false;
      const [small, big] = at.length <= tokens.length ? [at, tokens] : [tokens, at];
      return isSubset(small, big);
    }),
  );
  const compatible = similar.filter((c) => companyCompatible(company, c.company));
  if (compatible.length === 1) return { kind: "merge", id: compatible[0].id };
  if (compatible.length > 1) return { kind: "ambiguous", ids: compatible.map((c) => c.id) };
  return { kind: "new" };
}

export type BrandCandidate = { id: number; aliases: string[] };

/** "ASUS" and "ASUS ExpertBook P Series" are one brand; "Apple" and "Apple Cider Vinegar Co" are flagged. */
export function decideBrand(name: string, candidates: BrandCandidate[]): Decision {
  const key = normalize(name);
  if (!key) return { kind: "new" };
  const exact = candidates.find((c) => c.aliases.some((a) => normalize(a) === key));
  if (exact) return { kind: "exact", id: exact.id };

  const tokens = key.split(" ");
  const prefixMatch = candidates.filter((c) =>
    c.aliases.some((a) => {
      const at = normalize(a).split(" ");
      const [small, big] = at.length <= tokens.length ? [at, tokens] : [tokens, at];
      return small.length >= 1 && small.every((t, i) => big[i] === t);
    }),
  );
  if (prefixMatch.length === 1) return { kind: "merge", id: prefixMatch[0].id };
  if (prefixMatch.length > 1) return { kind: "ambiguous", ids: prefixMatch.map((c) => c.id) };
  return { kind: "new" };
}
