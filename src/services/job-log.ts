import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { jobRuns } = schema;

export type Detail = Record<string, unknown>;
export type JobName = "focused" | "discovery" | "weekly";

/** Runs `fn`, records start, finish, status and detail in job_runs, and never throws (cron must always answer). */
export async function tracked(job: JobName, fn: (detail: Detail) => Promise<void>): Promise<{ ok: boolean; detail: Detail }> {
  const [run] = await db.insert(jobRuns).values({ job }).returning({ id: jobRuns.id });
  const detail: Detail = {};
  let ok = true;
  try {
    await fn(detail);
  } catch (e) {
    ok = false;
    detail.error = e instanceof Error ? e.message : String(e);
  }
  await db.update(jobRuns).set({ finishedAt: new Date(), status: ok ? "ok" : "error", detail }).where(eq(jobRuns.id, run.id));
  return { ok, detail };
}

/** When the job last did real work (a run that was skipped as "not due" or "mode off" does not count). */
export async function lastRealRun(job: JobName): Promise<Date | null> {
  const res = (await db.execute(sql`
    select started_at as "startedAt" from job_runs
    where job = ${job} and status = 'ok' and coalesce(detail->>'skipped', '') = '' order by started_at desc limit 1`)) as unknown as { rows?: { startedAt: string }[] } | { startedAt: string }[];
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  return rows[0] ? new Date(rows[0].startedAt) : null;
}

export async function recentRuns(job: JobName | null, limit = 8) {
  const q = db.select().from(jobRuns);
  return (job ? q.where(eq(jobRuns.job, job)) : q).orderBy(desc(jobRuns.startedAt)).limit(limit);
}
