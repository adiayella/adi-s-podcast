import "./env";
import { neon } from "@neondatabase/serverless";
import { PROMPT_VERSION } from "@/nlp/taxonomy";
import { verifyExtraction } from "@/nlp/verify";
import type { Extraction } from "@/nlp/schema";

// Re-applies the current verification rules to stored model outputs. No Gemini calls, no cost.
// usage: npm run reverify
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const jobs = await sql`
    select j.id, j.raw_output, e.title, e.description
    from analysis_jobs j join episodes e on e.id = j.episode_id
    where j.status = 'done' and j.prompt_version = ${PROMPT_VERSION}`;
  let changed = 0;
  for (const j of jobs) {
    const raw = j.raw_output as { extraction: Extraction; rejected: Record<string, string[]>; usage: unknown };
    const v = verifyExtraction(raw.extraction, j.title, j.description ?? "");
    const before = raw.extraction.sponsors.length + raw.extraction.guests.length;
    const after = v.extraction.sponsors.length + v.extraction.guests.length;
    if (before === after && JSON.stringify(v.extraction) === JSON.stringify(raw.extraction)) continue;
    const rejected = Object.fromEntries(
      Object.keys(v.rejected).map((k) => [k, [...(raw.rejected?.[k] ?? []), ...v.rejected[k as keyof typeof v.rejected]]]),
    );
    await sql`update analysis_jobs set raw_output = ${JSON.stringify({ ...raw, extraction: v.extraction, rejected })}::jsonb, updated_at = now() where id = ${j.id}`;
    changed++;
  }
  console.log(`re-verified ${jobs.length} outputs, ${changed} changed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
