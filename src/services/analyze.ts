import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { db, schema } from "@/db";
import { extractEpisode } from "@/nlp/extract";
import { mergeDescriptions } from "@/nlp/text";
import { selectTopics } from "@/nlp/topics";
import { PROMPT_VERSION } from "@/nlp/taxonomy";

const { topics, episodeTopics } = schema;

const MAX_ATTEMPTS = 3;

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

/** Create a pending analysis job for every monitored-podcast episode that has none for this prompt version. */
export async function enqueueAnalysis(): Promise<number> {
  const res = await rows<{ id: number }>(sql`
    insert into analysis_jobs (episode_id, stage, status, prompt_version)
    select e.id, 'analyze', 'pending', ${PROMPT_VERSION}
    from episodes e join podcasts p on p.id = e.podcast_id and p.enabled
    on conflict (episode_id, stage, prompt_version) do nothing
    returning id
  `);
  return res.length;
}

type ClaimedJob = { id: number; episodeId: number; attempts: number };

// Atomically claim a batch. Stale 'running' jobs (a crashed worker) are picked up again after 10 minutes.
async function claimJobs(limit: number): Promise<ClaimedJob[]> {
  return rows<ClaimedJob>(sql`
    update analysis_jobs set status = 'running', updated_at = now()
    where id in (
      select id from analysis_jobs
      where stage = 'analyze' and prompt_version = ${PROMPT_VERSION} and attempts < ${MAX_ATTEMPTS}
        and (status in ('pending', 'failed') or (status = 'running' and updated_at < now() - interval '10 minutes'))
      order by id limit ${limit} for update skip locked
    )
    returning id, episode_id as "episodeId", attempts
  `);
}

async function processJob(job: ClaimedJob): Promise<{ ok: boolean; error?: string }> {
  try {
    const [ep] = await rows<{ title: string; description: string | null; ytDescription: string | null; publishedAt: string; podcast: string }>(sql`
      select e.title, e.description, e.published_at as "publishedAt", p.name as podcast,
             (select string_agg(s.description, chr(10)) from episode_sources s
               where s.episode_id = e.id and s.kind = 'youtube') as "ytDescription"
      from episodes e join podcasts p on p.id = e.podcast_id where e.id = ${job.episodeId}
    `);
    if (!ep) throw new Error("Episode no longer exists");

    const result = await extractEpisode({
      podcast: ep.podcast,
      title: ep.title,
      description: mergeDescriptions(ep.description ?? "", ep.ytDescription),
      publishedAt: new Date(ep.publishedAt).toISOString().slice(0, 10),
    });

    // Topics come from a controlled vocabulary, so they can be stored straight away.
    const kept = selectTopics(result.extraction.topics);
    if (kept.length) {
      await db
        .insert(topics)
        .values(kept.map((t) => ({ name: t.topic })))
        .onConflictDoNothing({ target: topics.name });
    }
    const topicRows = kept.length
      ? await rows<{ id: number; name: string }>(sql`select id, name from topics where name in (${sql.join(kept.map((t) => sql`${t.topic}`), sql`, `)})`)
      : [];
    const idByName = new Map(topicRows.map((t) => [t.name, t.id]));

    // Replace this episode's topics atomically so a re-run never double counts.
    const statements: BatchItem<"pg">[] = [
      db.delete(episodeTopics).where(sql`${episodeTopics.episodeId} = ${job.episodeId}`),
      ...(kept.length
        ? [
            db.insert(episodeTopics).values(
              kept.map((t) => ({
                episodeId: job.episodeId,
                topicId: idByName.get(t.topic)!,
                confidence: t.confidence,
                source: "metadata" as const,
              })),
            ),
          ]
        : []),
      db
        .update(schema.analysisJobs)
        .set({
          status: "done",
          attempts: job.attempts + 1,
          lastError: null,
          updatedAt: new Date(),
          rawOutput: {
            extraction: result.extraction,
            rejected: result.rejected,
            usage: { in: result.inputTokens, out: result.outputTokens },
          },
        })
        .where(sql`${schema.analysisJobs.id} = ${job.id}`),
    ];
    await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db
      .update(schema.analysisJobs)
      .set({ status: "failed", attempts: job.attempts + 1, lastError: error.slice(0, 500), updatedAt: new Date() })
      .where(sql`${schema.analysisJobs.id} = ${job.id}`);
    return { ok: false, error };
  }
}

export type BatchSummary = { claimed: number; done: number; failed: number; errors: string[] };

/** Process up to `limit` jobs, `concurrency` at a time. Safe to call repeatedly (e.g. from cron). */
export async function runAnalysisBatch(limit: number, concurrency = 4): Promise<BatchSummary> {
  const jobs = await claimJobs(limit);
  const summary: BatchSummary = { claimed: jobs.length, done: 0, failed: 0, errors: [] };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const r = await processJob(job);
        if (r.ok) summary.done++;
        else {
          summary.failed++;
          if (summary.errors.length < 5) summary.errors.push(r.error ?? "unknown");
        }
      }
    }),
  );
  return summary;
}

export async function analysisProgress() {
  const [r] = await rows<{ pending: number; running: number; done: number; failed: number }>(sql`
    select count(*) filter (where status = 'pending')::int as pending,
           count(*) filter (where status = 'running')::int as running,
           count(*) filter (where status = 'done')::int as done,
           count(*) filter (where status = 'failed')::int as failed
    from analysis_jobs where stage = 'analyze' and prompt_version = ${PROMPT_VERSION}
  `);
  return r;
}
