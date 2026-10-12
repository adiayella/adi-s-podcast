import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { isPublicHttpUrl } from "@/lib/url-safety";
import { PROMPT_VERSION } from "@/nlp/taxonomy";
import { countWords, parseTranscript, toPlainText } from "./parse";
import { permissionFor, type SourceKind } from "./policy";

const { episodeTranscripts: tr, episodes } = schema;

const MAX_BYTES = 8_000_000;
const MAX_ATTEMPTS = 3;

export type FetchSummary = { considered: number; fetched: number; failed: number; notPermitted: number; errors: string[] };

async function download(url: string): Promise<string> {
  if (!isPublicHttpUrl(url, true)) throw new Error("Refused: not a public https address");
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; PodcastRadar/1.0)" }, signal: AbortSignal.timeout(25_000), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error(`Too large (${declared} bytes)`);
  const body = await res.text();
  if (body.length > MAX_BYTES) throw new Error("Too large");
  return body;
}

type Pending = { id: number; episodeId: number; source: string; sourceUrl: string | null; format: string | null; attempts: number; allowPublic: boolean; audioRights: string };

/**
 * Download and store transcripts that were discovered in feeds. Each one goes through the rights gate first.
 * A stored transcript upgrades the episode to transcript-level coverage and sends it back for analysis.
 */
export async function fetchPendingTranscripts(opts: { limit?: number } = {}): Promise<FetchSummary> {
  const limit = opts.limit ?? 25;
  const res = (await db.execute(sql`
    select t.id, t.episode_id as "episodeId", t.source, t.source_url as "sourceUrl", t.format, t.attempts,
           p.allow_public_transcripts as "allowPublic", p.audio_transcription_rights as "audioRights"
    from episode_transcripts t join episodes e on e.id = t.episode_id join podcasts p on p.id = e.podcast_id
    where t.status in ('available', 'failed') and t.attempts < ${MAX_ATTEMPTS} and p.enabled
    order by e.published_at desc limit ${limit}`)) as unknown as { rows?: Pending[] } | Pending[];
  const pending = Array.isArray(res) ? res : (res.rows ?? []);
  const summary: FetchSummary = { considered: pending.length, fetched: 0, failed: 0, notPermitted: 0, errors: [] };

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (next < pending.length) {
        const p = pending[next++];
        const perm = permissionFor(p.source as SourceKind, { allowPublicTranscripts: p.allowPublic, audioTranscriptionRights: p.audioRights });
        if (!perm.allowed) {
          await db.update(tr).set({ status: "not_permitted", error: perm.reason }).where(eq(tr.id, p.id));
          summary.notPermitted++;
          continue;
        }
        try {
          if (!p.sourceUrl) throw new Error("No transcript URL");
          const body = await download(p.sourceUrl);
          const segments = parseTranscript(body, p.format);
          if (segments.length === 0) throw new Error("The transcript contained no text");
          const plain = toPlainText(segments);
          await db
            .update(tr)
            .set({
              status: "fetched",
              attempts: p.attempts + 1,
              error: null,
              plainText: plain,
              segments,
              wordCount: countWords(segments),
              contentHash: createHash("sha256").update(plain).digest("hex"),
              rightsBasis: perm.basis,
              fetchedAt: new Date(),
            })
            .where(eq(tr.id, p.id));
          // the episode now has transcript-level coverage and must be analysed again with the richer text
          await db.update(episodes).set({ coverage: "transcript", transcriptCheckedAt: new Date() }).where(eq(episodes.id, p.episodeId));
          await db.execute(sql`update analysis_jobs set status = 'pending', attempts = 0, last_error = null, updated_at = now()
            where episode_id = ${p.episodeId} and stage = 'analyze' and prompt_version = ${PROMPT_VERSION}`);
          summary.fetched++;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await db.update(tr).set({ status: "failed", attempts: p.attempts + 1, error: message.slice(0, 300) }).where(eq(tr.id, p.id));
          summary.failed++;
          if (summary.errors.length < 5) summary.errors.push(message);
        }
      }
    }),
  );
  return summary;
}
