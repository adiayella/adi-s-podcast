import "./env";
import { neon } from "@neondatabase/serverless";
import { runAnalysisBatch } from "@/services/analyze";
import { selectTopics } from "@/nlp/topics";
import { formatTimestamp } from "@/transcripts/parse";

// usage: npm run transcript-compare
// Re-analyses every episode that has a fetched transcript and compares it with the metadata-only result it replaces.
const sql = neon(process.env.DATABASE_URL!);
type Raw = { extraction: { guests: { name: string; category: string }[]; topics: { topic: string; confidence: number }[]; sponsors: { brand: string; classification: string; evidence: string }[] }; coverage?: string; timestamps?: { guests: Record<string, number>; sponsors: Record<string, number> }; usage?: { in: number; out: number } };

async function snapshot(version: string) {
  const r = await sql`select j.episode_id, e.title, j.raw_output from analysis_jobs j join episodes e on e.id = j.episode_id
    where e.coverage = 'transcript' and j.stage = 'analyze' and j.prompt_version = ${version} and j.status = 'done' order by j.episode_id`;
  return new Map(r.map((x) => [Number(x.episode_id), { title: String(x.title), raw: x.raw_output as Raw }]));
}

async function main() {
  // baseline = the metadata-only analysis (prompt v2) these episodes had before their transcripts were available
  const before = await snapshot("v2");
  console.log(`episodes with transcripts: ${before.size}; before-state coverage: ${[...new Set([...before.values()].map((v) => v.raw.coverage ?? "metadata"))].join(",")}`);
  const t0 = Date.now();
  let done = 0, failed = 0;
  for (let i = 0; i < 6; i++) { const s = await runAnalysisBatch(20, 3); done += s.done; failed += s.failed; if (s.claimed === 0) break; if (s.errors.length) console.log("errors:", s.errors); }
  console.log(`re-analysed: ${done} done, ${failed} failed in ${Math.round((Date.now() - t0) / 1000)}s`);
  const after = await snapshot("v3");

  let gAdded = 0, gLost = 0, sponsorsB = 0, sponsorsA = 0, tsCount = 0, tokIn = 0, tokOut = 0, topicChanged = 0, transcriptLevel = 0;
  const lines: string[] = [];
  for (const [id, a] of after) {
    const b = before.get(id)!;
    if (a.raw.coverage === "transcript") transcriptLevel++;
    const gb = new Set(b.raw.extraction.guests.map((g) => g.name)), ga = new Set(a.raw.extraction.guests.map((g) => g.name));
    const added = [...ga].filter((g) => !gb.has(g)), lost = [...gb].filter((g) => !ga.has(g));
    gAdded += added.length; gLost += lost.length;
    sponsorsB += b.raw.extraction.sponsors.length; sponsorsA += a.raw.extraction.sponsors.length;
    tsCount += Object.keys(a.raw.timestamps?.guests ?? {}).length + Object.keys(a.raw.timestamps?.sponsors ?? {}).length;
    tokIn += a.raw.usage?.in ?? 0; tokOut += a.raw.usage?.out ?? 0;
    const tb = selectTopics(b.raw.extraction.topics).map((t) => t.topic).sort().join("|"), ta = selectTopics(a.raw.extraction.topics).map((t) => t.topic).sort().join("|");
    if (tb !== ta) topicChanged++;
    if (added.length || lost.length || tb !== ta) lines.push(`  ${b.title.slice(0, 48).padEnd(48)} guests +[${added.join(", ")}] -[${lost.join(", ")}] | topics ${tb === ta ? "same" : `${tb.replace(/\|/g, ", ")}  ->  ${ta.replace(/\|/g, ", ")}`}`);
  }
  console.log(`\nanalysed at transcript level: ${transcriptLevel} of ${after.size}`);
  console.log(`guests: ${gAdded} added, ${gLost} dropped | sponsors found: metadata ${sponsorsB} -> transcript ${sponsorsA} | topic sets changed: ${topicChanged} of ${after.size}`);
  console.log(`evidence items with a timestamp: ${tsCount}`);
  console.log(`tokens: ${tokIn.toLocaleString()} in, ${tokOut.toLocaleString()} out  (about $${((tokIn * 1.5 + tokOut * 9) / 1e6).toFixed(2)} at $1.50 / $9.00 per million)`);
  console.log(lines.slice(0, 18).join("\n"));
  const first = [...after.values()].find((v) => Object.keys(v.raw.timestamps?.guests ?? {}).length);
  if (first) console.log(`\nexample timestamps for "${first.title.slice(0, 50)}": ` + Object.entries(first.raw.timestamps!.guests).map(([n, s]) => `${n} @ ${formatTimestamp(s)}`).join(", "));
}
main().catch((e) => { console.error(e); process.exit(1); });
