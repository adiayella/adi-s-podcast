import { describe, expect, it } from "vitest";
import { clockToSeconds, coalesceSegments, condenseForPrompt, countWords, formatTimestamp, locateQuote, parseTranscript, pickTranscriptLink, toPlainText } from "./parse";

// Shapes copied from real feeds: an SRT with CRLF line endings and "Speaker N:" prefixes (Economic Times),
// and the HTML transcript with <cite>/<time>/<span data-t> that The Neon Show publishes.
const SRT = "1\r\n00:00:00,519 --> 00:00:04,550\r\nSpeaker 1: This podcast is brought to you in association with BSC\r\n\r\n2\r\n00:00:04,630 --> 00:00:09,000\r\nSpeaker 2: Welcome to The Morning Brief.\r\n\r\n3\r\n01:02:03,000 --> 01:02:08,000\r\nSpeaker 1: And that is all for today.\r\n";

const VTT = "WEBVTT\n\nNOTE made by a tool\n\n00:00:01.000 --> 00:00:03.500 align:start\nHello there and welcome\n\n00:00:03.500 --> 00:00:06.000\nto the show\n";

const JSON_T = JSON.stringify({ version: "1.0.0", segments: [{ speaker: "Host", startTime: 0, endTime: 3.2, body: "Welcome back to the show." }, { speaker: "Guest", startTime: 3.4, endTime: 9, body: "Thanks for having me, I run Acme Robotics." }, { body: "   " }] });

const HTML = `<html><body>
<cite>SPEAKER_00</cite>
<time>0:00</time>
<p><span data-t="0.1">A</span> <span data-t="0.4">warm</span> welcome to the Neon show</p>
<cite>SPEAKER_01</cite>
<time>1:05</time>
<p>Thanks, glad to be here &amp; talking about venture capital.</p>
</body></html>`;

describe("parsing real transcript formats", () => {
  it("parses SRT with CRLF and splits the speaker label", () => {
    const s = parseTranscript(SRT, "application/x-subrip");
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ speaker: "Speaker 1", start: 0.519, end: 4.55 });
    expect(s[0].text).toBe("This podcast is brought to you in association with BSC");
    expect(s[2].start).toBe(3723);
  });

  it("parses WebVTT, ignoring the header, notes and cue settings", () => {
    const s = parseTranscript(VTT, "text/vtt");
    expect(s.map((x) => x.text)).toEqual(["Hello there and welcome", "to the show"]);
    expect(s[0].start).toBe(1);
  });

  it("parses Podcasting 2.0 JSON and skips empty segments", () => {
    const s = parseTranscript(JSON_T, "application/json");
    expect(s).toHaveLength(2);
    expect(s[1]).toMatchObject({ speaker: "Guest", start: 3.4 });
  });

  it("parses the HTML transcript with speakers and times", () => {
    const s = parseTranscript(HTML, "text/html; charset=utf-8");
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ speaker: "SPEAKER_00", start: 0 });
    expect(s[1]).toMatchObject({ speaker: "SPEAKER_01", start: 65 });
    expect(s[1].text).toContain("& talking about venture capital");
  });

  it("detects the format from the content when the MIME type is wrong", () => {
    expect(parseTranscript(SRT, "text/plain")).toHaveLength(3);
    expect(parseTranscript(JSON_T, "text/plain")).toHaveLength(2);
  });

  it("treats plain text as untimed paragraphs", () => {
    const s = parseTranscript("First paragraph.\n\nSecond paragraph.", "text/plain");
    expect(s).toHaveLength(2);
    expect(s[0].start).toBeNull();
  });

  it("counts words and renders plain text", () => {
    const s = parseTranscript(SRT, "application/x-subrip");
    expect(countWords(s)).toBeGreaterThan(15);
    expect(toPlainText(s)).toContain("Speaker 2: Welcome to The Morning Brief.");
  });
});

describe("word-level transcripts", () => {
  const words = "Welcome back to the show today we talk about venture capital and artificial intelligence in India".split(" ").map((w, i) => ({ start: i * 0.4, end: i * 0.4 + 0.3, speaker: "A", text: w }));

  it("merges per-word segments from one speaker into phrases", () => {
    const merged = coalesceSegments(words, 6);
    expect(merged.length).toBeLessThan(words.length);
    expect(merged[0].text).toBe("Welcome back to the show today");
    expect(merged[0].start).toBe(0);
    expect(merged[0].end).toBeCloseTo(5 * 0.4 + 0.3, 5);
  });

  it("never merges across a change of speaker", () => {
    const merged = coalesceSegments([{ start: 0, end: 1, speaker: "A", text: "hello" }, { start: 1, end: 2, speaker: "B", text: "hi there" }], 30);
    expect(merged).toHaveLength(2);
  });

  it("still locates a quote to the right timestamp after merging", () => {
    const body = JSON.stringify({ segments: words.map((w) => ({ speaker: w.speaker, startTime: w.start, endTime: w.end, body: w.text })) });
    const segs = parseTranscript(body, "application/json");
    expect(segs.length).toBeLessThan(words.length);
    expect(locateQuote(segs, "talk about venture capital")).toBeLessThan(10);
  });
});

describe("timestamps are found by code, not invented by the model", () => {
  const s = parseTranscript(SRT, "application/x-subrip");

  it("locates a quote and returns the start of its segment", () => {
    expect(locateQuote(s, "brought to you in association with BSC")).toBe(0.519);
    expect(locateQuote(s, "that is all for today")).toBe(3723);
  });

  it("ignores case and punctuation differences in the quote", () => {
    expect(locateQuote(s, "WELCOME to the morning brief")).toBe(4.63);
  });

  it("returns null for a quote that was never said", () => {
    expect(locateQuote(s, "this episode is sponsored by ZetaCorp")).toBeNull();
  });

  it("returns null when the transcript has no timing", () => {
    expect(locateQuote(parseTranscript("We are brought to you by Acme today.", "text/plain"), "brought to you by Acme today")).toBeNull();
  });

  it("formats seconds as hh:mm:ss", () => {
    expect(formatTimestamp(3723)).toBe("01:02:03");
    expect(clockToSeconds("1:05")).toBe(65);
  });
});

describe("prompt text", () => {
  it("is timestamped and merges neighbouring lines from one speaker", () => {
    const segs = parseTranscript(JSON.stringify({ segments: [{ speaker: "A", startTime: 0, body: "one" }, { speaker: "A", startTime: 2, body: "two" }, { speaker: "B", startTime: 4, body: "three" }] }), "application/json");
    expect(condenseForPrompt(segs).split("\n")).toEqual(["[00:00:00] A: one two", "[00:00:04] B: three"]);
  });

  it("keeps the start and the end of a very long transcript", () => {
    const segs = Array.from({ length: 2000 }, (_, i) => ({ start: i * 10, end: null, speaker: i % 2 ? "B" : "A", text: `sentence number ${i} ${"word ".repeat(10)}` }));
    const out = condenseForPrompt(segs, 5000);
    expect(out.length).toBeLessThan(5200);
    expect(out).toContain("sentence number 0");
    expect(out).toContain("sentence number 1999");
    expect(out).toContain("middle of the transcript omitted");
  });
});

describe("choosing a published transcript link", () => {
  it("prefers JSON, then SRT, then VTT, and skips non-HTTPS links", () => {
    const pick = pickTranscriptLink([
      { url: "https://x.test/t.html", type: "text/html" },
      { url: "http://x.test/t.json", type: "application/json" },
      { url: "https://x.test/t.srt", type: "application/x-subrip" },
      { url: "https://x.test/t.vtt", type: "text/vtt" },
    ]);
    expect(pick?.url).toBe("https://x.test/t.srt");
  });

  it("returns null when nothing usable is published", () => {
    expect(pickTranscriptLink([{ url: "https://x.test/a.pdf", type: "application/pdf" }])).toBeNull();
  });
});
