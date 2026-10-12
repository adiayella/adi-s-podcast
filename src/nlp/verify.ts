import type { Extraction } from "./schema";

// Evidence verification: Gemini proposes, this code disposes. Every guest name and every
// evidence quote must be found in the episode's own text, otherwise it is dropped or downgraded.

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textContains(haystackNorm: string, needle: string): boolean {
  const n = normalize(needle);
  return n.length > 0 && haystackNorm.includes(n);
}

// A guest must be a person's name, not a job title or a group ("India's IT Secretary", "The panel").
const NOT_A_NAME = /\b(secretary|minister|ceo|cfo|cto|founder|co-founder|president|chairman|director|governor|team|panel|speaker|host|guest|guests|experts?|analysts?|officials?|company|startup)\b/i;
export function looksLikePersonName(name: string): boolean {
  const n = name.trim();
  const words = n.split(/\s+/);
  return words.length <= 5 && !NOT_A_NAME.test(n) && /\p{L}/u.test(n);
}

// Every meaningful token of the name must appear in the text ("Aadit Palicha" -> aadit, palicha).
function nameAppears(haystackNorm: string, name: string): boolean {
  const tokens = normalize(name).split(" ").filter((t) => t.length > 1);
  if (tokens.length === 0) return false;
  const words = new Set(haystackNorm.split(" "));
  return tokens.every((t) => words.has(t));
}

// An explicit or paid label needs a sponsorship cue in the quoted evidence itself.
const SPONSOR_CUE =
  /sponsor|brought to you|presented by|in partnership|partner|paid|promot|advert|\bads?\b|#ad|supported by|powered by|collaborat|use code|promo code|coupon|discount|referral|affiliate|use our link|offer/i;

// The host talking about their own product: "download my wellness app", "join our community".
const SELF_PROMO =
  /\b(my|our|mine)\s+(?:[\w'’-]+\s+){0,4}(app|course|newsletter|community|book|brand|company|startup|program|programme|platform|channel|podcast|product|store|membership|workshop|masterclass)\b/i;

export type VerifiedExtraction = {
  extraction: Extraction;
  rejected: { guests: string[]; sponsors: string[]; downgraded: string[]; selfPromotion: string[] };
};

export function verifyExtraction(raw: Extraction, title: string, description: string): VerifiedExtraction {
  const hay = normalize(`${title} ${description}`);
  const rejected = { guests: [] as string[], sponsors: [] as string[], downgraded: [] as string[], selfPromotion: [] as string[] };

  const guests = raw.guests.flatMap((g) => {
    if (!looksLikePersonName(g.name) || !nameAppears(hay, g.name)) {
      rejected.guests.push(g.name);
      return [];
    }
    const evidence = g.evidence && textContains(hay, g.evidence) ? g.evidence : "";
    return [{ ...g, evidence }];
  });

  const sponsors = raw.sponsors.flatMap((s) => {
    if (!nameAppears(hay, s.brand)) {
      rejected.sponsors.push(s.brand);
      return [];
    }
    // The model is asked to flag self-promotion, but a rule-based backstop catches "my app", "our course" etc.
    if (s.selfPromotion || SELF_PROMO.test(s.evidence)) {
      rejected.selfPromotion.push(s.brand);
      return [];
    }
    const quoteOk = s.evidence !== "" && textContains(hay, s.evidence);
    if (!quoteOk) {
      // No verifiable quote: the brand may be real, but nothing supports a promotional label.
      rejected.sponsors.push(`${s.brand} (no verifiable quote)`);
      return [];
    }
    let classification = s.classification;
    if ((classification === "explicit_sponsor" || classification === "paid_promotion") && !SPONSOR_CUE.test(s.evidence)) {
      rejected.downgraded.push(`${s.brand}: ${classification} -> unknown`);
      classification = "unknown";
    }
    return [{ ...s, classification }];
  });

  return { extraction: { ...raw, guests, sponsors }, rejected };
}
