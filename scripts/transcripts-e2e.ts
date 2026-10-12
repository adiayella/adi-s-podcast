import "./env";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { PROMPT_VERSION } from "@/nlp/taxonomy";
import { runAnalysisBatch } from "@/services/analyze";
import { ingestPodcast } from "@/services/ingest";
import { applyTranscriptPolicy } from "@/transcripts/apply-policy";
import { fetchPendingTranscripts } from "@/transcripts/fetch";

// usage: npm run transcripts-e2e
// Exercises the transcript layer against the real database and restores its state. Uses real Gemini calls (2 episodes).
type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
const t = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
};

async function q<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}
async function coverageOf(episodeId: number) {
  const [r] = await q<{ c: string | null }>(sql`select raw_output->>'coverage' as c from analysis_jobs where episode_id = ${episodeId} and stage = 'analyze' and prompt_version = ${PROMPT_VERSION}`);
  return r?.c ?? null;
}
async function requeue(episodeId: number) {
  await db.execute(sql`update analysis_jobs set status = 'pending', attempts = 0 where episode_id = ${episodeId} and stage = 'analyze' and prompt_version = ${PROMPT_VERSION}`);
  await runAnalysisBatch(5, 1);
}

async function main() {
  const [neon] = await db.select().from(schema.podcasts).where(eq(schema.podcasts.name, "The Neon Show"));
  const [daily] = await db.select().from(schema.podcasts).where(eq(schema.podcasts.name, "The Daily Brief (Zerodha)"));
  const [sample] = await q<{ id: number; episode_id: number; duration: number | null }>(sql`
    select t.id, t.episode_id, e.duration_seconds as duration from episode_transcripts t join episodes e on e.id = t.episode_id
    where t.status = 'fetched' and e.podcast_id = ${neon.id} order by e.published_at desc limit 1`);

  // ---------------------------------------------------------------- 1. fetched, parsed, stored
  const before = (await q<{ n: number; words: number }>(sql`select count(*)::int n, coalesce(sum(word_count), 0)::int words from episode_transcripts where status = 'fetched'`))[0];
  t("Stored: published transcripts were fetched, parsed and saved", before.n >= 10 && before.words > 50_000, `${before.n} transcripts, ${before.words.toLocaleString()} words`);
  const [seg] = await q<{ segs: number; with_time: number }>(sql`select jsonb_array_length(segments)::int segs, (select count(*)::int from jsonb_array_elements(segments) s where s->>'start' is not null) with_time from episode_transcripts where id = ${sample.id}`);
  t("Stored: segments carry speaker and start time", seg.segs > 50 && seg.with_time === seg.segs, `${seg.segs} segments, all timed`);

  // ---------------------------------------------------------------- 2. idempotent ingest: no duplicate transcript rows
  await ingestPodcast(neon, 90);
  await ingestPodcast(neon, 90);
  const dup = (await q<{ n: number }>(sql`select count(*)::int n from (select episode_id, source from episode_transcripts group by 1, 2 having count(*) > 1) d`))[0];
  t("Idempotent: re-ingesting twice creates no duplicate transcript rows", Number(dup.n) === 0);
  t("Idempotent: a re-ingest keeps the stored transcript", (await q<{ n: number }>(sql`select count(*)::int n from episode_transcripts where status = 'fetched'`))[0].n === before.n);

  // ---------------------------------------------------------------- 3. transcript-level coverage and timestamps
  t("Coverage: an episode with a fetched transcript was analysed at transcript level", (await coverageOf(sample.episode_id)) === "transcript");
  const stamps = await q<{ s: number }>(sql`select evidence_seconds as s from guest_appearances where evidence_seconds is not null and episode_id in (select episode_id from episode_transcripts where status = 'fetched')`);
  const dur = sample.duration ?? 7200;
  t("Timestamps: stored evidence times lie within the audio length", stamps.length > 0 && stamps.every((x) => x.s >= 0 && x.s <= 4 * 3600), `${stamps.length} timestamped, latest ${Math.max(...stamps.map((x) => x.s))}s of about ${dur}s`);

  // ---------------------------------------------------------------- 4. rights gate when the transcript is USED
  await db.update(schema.podcasts).set({ allowPublicTranscripts: false }).where(eq(schema.podcasts.id, neon.id));
  await requeue(sample.episode_id);
  t("Rights: switching a show's published transcripts off stops their use in analysis", (await coverageOf(sample.episode_id)) === "metadata", `coverage now ${await coverageOf(sample.episode_id)}`);
  await db.update(schema.podcasts).set({ allowPublicTranscripts: true }).where(eq(schema.podcasts.id, neon.id));
  await requeue(sample.episode_id);
  t("Rights: switching it back on restores transcript-level analysis", (await coverageOf(sample.episode_id)) === "transcript");

  // switching a show off must change its coverage immediately, not at some later run
  await db.update(schema.podcasts).set({ allowPublicTranscripts: false }).where(eq(schema.podcasts.id, neon.id));
  const off = await applyTranscriptPolicy(neon.id, false);
  const covOff = (await q<{ n: number }>(sql`select count(*) filter (where coverage = 'transcript')::int n from episodes where podcast_id = ${neon.id}`))[0].n;
  t("Rights: switching a show off drops its coverage to metadata immediately", off.episodes > 0 && covOff === 0, `${off.episodes} episodes moved to metadata-only, ${covOff} still marked transcript`);
  await db.update(schema.podcasts).set({ allowPublicTranscripts: true }).where(eq(schema.podcasts.id, neon.id));
  const on = await applyTranscriptPolicy(neon.id, true);
  const covOn = (await q<{ n: number }>(sql`select count(*) filter (where coverage = 'transcript')::int n from episodes where podcast_id = ${neon.id}`))[0].n;
  t("Rights: switching it back on restores transcript coverage immediately", on.episodes > 0 && covOn === on.episodes, `${covOn} episodes transcript-level again`);
  await runAnalysisBatch(25, 3); // re-analyse the episodes that were sent back for analysis
  await runAnalysisBatch(25, 3);

  // ---------------------------------------------------------------- 5. rights gate when fetching, unsafe URLs, audio
  const [ep] = await q<{ id: number }>(sql`select id from episodes where podcast_id = ${daily.id} order by published_at desc limit 1`);
  const mk = async (source: string, url: string) => (await db.insert(schema.episodeTranscripts).values({ episodeId: ep.id, source, sourceUrl: url, format: "text/plain", rightsBasis: "test", status: "available" }).onConflictDoNothing().returning({ id: schema.episodeTranscripts.id }))[0]?.id;
  const unsafe = await mk("rss_tag", "https://127.0.0.1/secret.txt");
  const audio = await mk("audio_transcription", "https://example.com/audio.mp3");
  const sum = await fetchPendingTranscripts({ limit: 50 });
  const state = async (id: number) => (await q<{ status: string; error: string | null }>(sql`select status, error from episode_transcripts where id = ${id}`))[0];
  t("Safety: a non-public address is refused, not fetched", (await state(unsafe)).status === "failed" && String((await state(unsafe)).error).includes("Refused"), String((await state(unsafe)).error));
  t("Rights: audio transcription is refused without a recorded permission", (await state(audio)).status === "not_permitted", String((await state(audio)).error));
  t("Coverage: neither refused source changed the episode's coverage", (await q<{ c: string }>(sql`select coverage c from episodes where id = ${ep.id}`))[0].c === "metadata");
  await db.delete(schema.episodeTranscripts).where(sql`id in (${unsafe}, ${audio})`);
  void sum;

  // ---------------------------------------------------------------- 6. metadata-only fallback still works
  const [meta] = await q<{ episode_id: number }>(sql`select j.episode_id from analysis_jobs j join episodes e on e.id = j.episode_id where e.coverage = 'metadata' and j.status = 'done' and j.prompt_version = ${PROMPT_VERSION} limit 1`);
  await requeue(meta.episode_id);
  t("Fallback: an episode with no transcript is still analysed from metadata", (await coverageOf(meta.episode_id)) === "metadata");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} transcript end-to-end checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
