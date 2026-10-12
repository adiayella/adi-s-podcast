import { describe, expect, it } from "vitest";
import { descriptionKey, durationToSeconds, durationsCompatible, isReupload } from "./episode-dedupe";

const LONG = "AI is getting better at answering questions. But what happens when it starts asking and solving the questions scientists haven't answered yet? In this episode of SparX, Mukesh Bansal sits down with Paras Chopra, founder of Wingify and Lossfunk.";
const day = (d: number) => new Date(Date.UTC(2026, 9, d));

describe("re-upload detection", () => {
  const known = [{ dedupeKey: "nobel prize winner quantum", descKey: descriptionKey(LONG), publishedAt: day(2) }];

  it("catches the same description re-titled within 3 days (the SparX case)", () => {
    expect(isReupload({ dedupeKey: "india s top ai researcher", descKey: descriptionKey(LONG), publishedAt: day(2) }, known)).toBe(true);
  });

  it("does not merge episodes with different descriptions", () => {
    expect(isReupload({ dedupeKey: "other", descKey: descriptionKey(LONG + " Completely different guest and topic follow here."), publishedAt: day(2) }, known)).toBe(false);
  });

  it("does not merge the same description published weeks apart (recurring boilerplate)", () => {
    expect(isReupload({ dedupeKey: "x", descKey: descriptionKey(LONG), publishedAt: day(20) }, known)).toBe(false);
  });

  it("never treats a short or empty description as a fingerprint", () => {
    expect(descriptionKey("New episode out now!")).toBeNull();
    expect(isReupload({ dedupeKey: "y", descKey: null, publishedAt: day(2) }, known)).toBe(false);
  });

  it("an episode is not a duplicate of itself", () => {
    expect(isReupload({ dedupeKey: "nobel prize winner quantum", descKey: descriptionKey(LONG), publishedAt: day(2) }, known)).toBe(false);
  });
});

describe("shared boilerplate is not a duplicate", () => {
  // Real pattern: Ranveer's descriptions start with the same app and course links, then differ.
  const BOILER = "Download my meditation and wellness app, Swa:aha. https://app.level.game/?c=zSbmYn Check out BeerBiceps SkillHouse Courses Here - https://linktr.ee/bbskillhouse Share your guest suggestions here Mail - connect@beerbiceps.com Link - https://forms.gle/aoMHY9EE3Cg3Tqdx9 ";
  it("two episodes with the same top links but different bodies are kept apart", () => {
    const a = { dedupeKey: "space hero", descKey: descriptionKey(BOILER + "In this episode we are joined by a rocket scientist to discuss India's space economy and launch vehicles."), publishedAt: day(5) };
    const b = { dedupeKey: "kailash kher", descKey: descriptionKey(BOILER + "In this episode we are joined by the singer Kailash Kher to talk about music, devotion and his early struggles."), publishedAt: day(5) };
    expect(descriptionKey(BOILER + "x".repeat(10))).not.toBe(b.descKey);
    expect(isReupload(a, [b])).toBe(false);
  });
});

describe("durations", () => {
  it("parses seconds, mm:ss and hh:mm:ss", () => {
    expect(durationToSeconds("3600")).toBe(3600);
    expect(durationToSeconds("62:03")).toBe(3723);
    expect(durationToSeconds("1:02:03")).toBe(3723);
  });
  it("treats junk and zero as unknown", () => {
    expect(durationToSeconds("abc")).toBeNull();
    expect(durationToSeconds("0")).toBeNull();
    expect(durationToSeconds(undefined)).toBeNull();
  });
  it("matches an RSS episode to a video of about the same length and rejects a short clip", () => {
    expect(durationsCompatible(3600, 3540)).toBe(true);
    expect(durationsCompatible(3600, 420)).toBe(false);
    expect(durationsCompatible(null, 420)).toBe(true);
  });
});
