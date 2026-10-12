import { describe, expect, it } from "vitest";
import { looksLikePersonName, verifyExtraction } from "./verify";
import type { Extraction } from "./schema";

const base: Extraction = { episodeType: "interview", guests: [], topics: [], sponsors: [] };
const guest = (name: string) => ({ name, role: "", company: "", category: "founder" as const, confidence: 0.9, evidence: "" });
const sponsor = (brand: string, evidence: string, classification: Extraction["sponsors"][number]["classification"] = "explicit_sponsor", selfPromotion = false) => ({
  brand, category: "x", classification, selfPromotion, evidence, confidence: 0.9,
});

describe("verification", () => {
  it("accepts person names and rejects job titles", () => {
    expect(looksLikePersonName("Aadit Palicha")).toBe(true);
    expect(looksLikePersonName("India's IT Secretary")).toBe(false);
    expect(looksLikePersonName("The panel")).toBe(false);
  });

  it("drops a guest who is not named in the text (hallucination / prompt injection)", () => {
    const r = verifyExtraction({ ...base, guests: [guest("Jane Roe"), guest("Elon Musk")] }, "Building with Jane Roe", "Jane Roe talks hardware.");
    expect(r.extraction.guests.map((g) => g.name)).toEqual(["Jane Roe"]);
    expect(r.rejected.guests).toEqual(["Elon Musk"]);
  });

  it("drops a sponsor whose quote is not in the text", () => {
    const r = verifyExtraction({ ...base, sponsors: [sponsor("ZetaCorp", "brought to you by ZetaCorp")] }, "Title", "Nothing about sponsors here, ZetaCorp aside.");
    expect(r.extraction.sponsors).toEqual([]);
  });

  it("keeps a verifiable explicit sponsor", () => {
    const r = verifyExtraction({ ...base, sponsors: [sponsor("Urban Platter", "This episode is brought to you by Urban Platter.")] }, "T", "This episode is brought to you by Urban Platter. More text.");
    expect(r.extraction.sponsors[0].classification).toBe("explicit_sponsor");
  });

  it("downgrades an explicit label whose quote has no sponsorship cue", () => {
    const r = verifyExtraction({ ...base, sponsors: [sponsor("Porter", "Download Porter Here")] }, "T", "Download Porter Here: link");
    expect(r.extraction.sponsors[0].classification).toBe("unknown");
  });

  it("removes the host's own product, even if the model did not flag it", () => {
    const r = verifyExtraction({ ...base, sponsors: [sponsor("Swa:aha", "Download my meditation and wellness app, Swa:aha.", "possible_affiliate")] }, "T", "Download my meditation and wellness app, Swa:aha. link");
    expect(r.extraction.sponsors).toEqual([]);
    expect(r.rejected.selfPromotion).toEqual(["Swa:aha"]);
  });
});
