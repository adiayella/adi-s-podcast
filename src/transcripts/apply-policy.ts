import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PROMPT_VERSION } from "@/nlp/taxonomy";

/**
 * A show's transcript permission changed. Make the data match immediately, not at some later run:
 *  - off: its episodes drop back to metadata-level coverage and are re-analysed from title and description only
 *  - on:  episodes that already have a stored transcript return to transcript-level and are re-analysed with it
 * The re-analysis itself happens in the next focused run; until then the coverage flag already tells the truth.
 */
export async function applyTranscriptPolicy(podcastId: number, allowPublic: boolean): Promise<{ episodes: number }> {
  const changed = (await db.execute(
    allowPublic
      ? sql`update episodes e set coverage = 'transcript' where e.podcast_id = ${podcastId} and e.coverage <> 'transcript'
            and exists (select 1 from episode_transcripts t where t.episode_id = e.id and t.status = 'fetched' and t.source in ('rss_tag', 'public_page'))
            returning e.id`
      : sql`update episodes e set coverage = 'metadata' where e.podcast_id = ${podcastId} and e.coverage = 'transcript'
            and not exists (select 1 from episode_transcripts t where t.episode_id = e.id and t.status = 'fetched' and t.source not in ('rss_tag', 'public_page'))
            returning e.id`,
  )) as unknown as { rows?: { id: number }[] } | { id: number }[];
  const ids = (Array.isArray(changed) ? changed : (changed.rows ?? [])).map((r) => r.id);
  if (ids.length) {
    await db.execute(sql`update analysis_jobs set status = 'pending', attempts = 0, last_error = null, updated_at = now()
      where stage = 'analyze' and prompt_version = ${PROMPT_VERSION} and episode_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  }
  return { episodes: ids.length };
}
