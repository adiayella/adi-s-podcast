import { normalize } from "@/nlp/verify";

// Parsing of the transcript formats podcasts actually publish. Everything becomes the same shape:
// ordered segments with optional start/end seconds and an optional speaker.

export type Segment = { start: number | null; end: number | null; speaker: string | null; text: string };

const clean = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ").trim();

/** "00:01:02,500" or "01:02.500" or "1:02" -> seconds */
export function clockToSeconds(t: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(t.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0);
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// "Speaker 1: Hello" -> speaker + text
function splitSpeaker(line: string): { speaker: string | null; text: string } {
  const m = /^([A-Z][\w .'-]{0,30}?):\s+(.*)$/.exec(line);
  return m && !/^(http|https)$/i.test(m[1]) ? { speaker: m[1].trim(), text: m[2] } : { speaker: null, text: line };
}

/** SubRip (.srt) and WebVTT (.vtt): cue blocks separated by blank lines, each with a "start --> end" line. */
export function parseCues(body: string): Segment[] {
  const out: Segment[] = [];
  for (const block of body.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() && !/^WEBVTT|^NOTE\b|^STYLE\b/.test(l));
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->").map((x) => x.trim().split(/\s+/)[0]);
    const text = clean(lines.slice(i + 1).join(" "));
    if (!text) continue;
    const { speaker, text: t } = splitSpeaker(text);
    out.push({ start: clockToSeconds(a), end: clockToSeconds(b), speaker, text: t });
  }
  return out;
}

/** Podcasting 2.0 JSON transcript: { segments: [{ speaker, startTime, endTime, body }] }. */
export function parsePodcastJson(body: string): Segment[] {
  const j = JSON.parse(body) as { segments?: { speaker?: string; startTime?: number; endTime?: number; body?: string }[] };
  return (j.segments ?? [])
    .filter((s) => s.body && s.body.trim())
    .map((s) => ({ start: typeof s.startTime === "number" ? s.startTime : null, end: typeof s.endTime === "number" ? s.endTime : null, speaker: s.speaker ?? null, text: clean(s.body!) }));
}

/** The HTML transcript some hosts publish: <cite>SPEAKER</cite><time>0:00</time><p>...<span data-t="0.1">word</span>...</p> */
export function parseHtmlTranscript(body: string): Segment[] {
  const out: Segment[] = [];
  const re = /<cite>([^<]*)<\/cite>\s*<time>([^<]*)<\/time>\s*<p>([\s\S]*?)<\/p>/gi;
  for (const m of body.matchAll(re)) {
    const text = clean(m[3]);
    if (!text) continue;
    out.push({ start: clockToSeconds(m[2]), end: null, speaker: m[1].trim() || null, text });
  }
  if (out.length) return out;
  return parsePlain(clean(body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")));
}

/** Plain text carries no timing; paragraphs become segments so quotes can still be located. */
export function parsePlain(body: string): Segment[] {
  return body
    .replace(/\r/g, "")
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const { speaker, text } = splitSpeaker(p);
      return { start: null, end: null, speaker, text };
    });
}

/**
 * Some feeds publish one segment per WORD. Merge consecutive segments from the same speaker into phrase-sized ones
 * (about 30 words or 20 seconds), keeping the start of the first word and the end of the last.
 */
export function coalesceSegments(segments: Segment[], maxWords = 30, maxSeconds = 20): Segment[] {
  const out: Segment[] = [];
  let cur: Segment | null = null;
  let words = 0;
  for (const s of segments) {
    const w = s.text.match(/\S+/g)?.length ?? 0;
    const sameSpeaker = cur !== null && cur.speaker === s.speaker;
    const fits = cur !== null && words + w <= maxWords && (cur.start === null || s.start === null || s.start - cur.start <= maxSeconds);
    if (cur && sameSpeaker && fits) {
      cur.text += " " + s.text;
      cur.end = s.end ?? cur.end;
      words += w;
    } else {
      if (cur) out.push(cur);
      cur = { ...s };
      words = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Detect the format from the published MIME type, falling back to what the content looks like. */
export function parseTranscript(body: string, mime: string | null | undefined): Segment[] {
  const raw = parseRaw(body, mime);
  // Only word-level input (about one word per segment) is merged. Cues and paragraphs are already the right size.
  return raw.length > 0 && countWords(raw) / raw.length <= 1.3 ? coalesceSegments(raw) : raw;
}

function parseRaw(body: string, mime: string | null | undefined): Segment[] {
  const type = (mime ?? "").toLowerCase();
  const head = body.trimStart().slice(0, 200);
  if (type.includes("json") || head.startsWith("{")) return parsePodcastJson(body);
  if (type.includes("vtt") || type.includes("subrip") || type.includes("srt") || head.startsWith("WEBVTT") || /^\d+\s*\r?\n\d\d:\d\d:\d\d[,.]\d+ -->/.test(head)) return parseCues(body);
  if (type.includes("html") || head.startsWith("<")) return parseHtmlTranscript(body);
  return parsePlain(body);
}

export function toPlainText(segments: Segment[]): string {
  return segments.map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text)).join("\n");
}

export const countWords = (segments: Segment[]) => segments.reduce((n, s) => n + (s.text.match(/\S+/g)?.length ?? 0), 0);

/**
 * Where was this said? Finds the segment containing the start of `quote` and returns its start time in seconds.
 * The model only ever supplies the quote; the timestamp is found by code, so it cannot be invented.
 */
export function locateQuote(segments: Segment[], quote: string, minWords = 3): number | null {
  const words = normalize(quote).split(" ").filter(Boolean).slice(0, 14);
  if (words.length < minWords) return null;
  const needle = words.join(" ");
  let joined = "";
  const starts: number[] = [];
  for (const s of segments) {
    starts.push(joined.length);
    joined += normalize(s.text) + " ";
  }
  const idx = joined.indexOf(needle);
  if (idx < 0) return null;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= idx) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo].start;
}

/**
 * Compact, timestamped text for the model: "[00:12:31] Speaker: ..." with neighbouring lines from one speaker merged.
 * Very long transcripts keep the opening and the ending, where introductions and sponsor reads usually sit.
 */
export function condenseForPrompt(segments: Segment[], maxChars = 400_000): string {
  const lines: string[] = [];
  let cur: { start: number | null; speaker: string | null; text: string } | null = null;
  const flush = () => {
    if (!cur) return;
    lines.push(`${cur.start !== null ? `[${formatTimestamp(cur.start)}] ` : ""}${cur.speaker ? `${cur.speaker}: ` : ""}${cur.text}`);
    cur = null;
  };
  for (const s of segments) {
    if (cur && cur.speaker === s.speaker && cur.text.length < 600) cur.text += " " + s.text;
    else {
      flush();
      cur = { start: s.start, speaker: s.speaker, text: s.text };
    }
  }
  flush();
  const full = lines.join("\n");
  if (full.length <= maxChars) return full;
  const head = full.slice(0, Math.floor(maxChars * 0.55));
  const tail = full.slice(full.length - Math.floor(maxChars * 0.45));
  return `${head}\n[... middle of the transcript omitted to fit the length limit ...]\n${tail}`;
}

// ---------------------------------------------------------------- choosing among several published links
export type TranscriptLink = { url: string; type: string };

const PREFERENCE = ["application/json", "application/x-subrip", "application/srt", "text/vtt", "text/plain", "text/html"];

/** Of the formats a feed publishes for one episode, take the most structured one. HTTPS only, as the spec requires. */
export function pickTranscriptLink(links: TranscriptLink[]): TranscriptLink | null {
  const usable = links.filter((l) => /^https:\/\//i.test(l.url) && PREFERENCE.includes(l.type.toLowerCase()));
  usable.sort((a, b) => PREFERENCE.indexOf(a.type.toLowerCase()) - PREFERENCE.indexOf(b.type.toLowerCase()));
  return usable[0] ?? null;
}
