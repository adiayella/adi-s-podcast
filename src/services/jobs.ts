import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { analysisProgress, enqueueAnalysis, runAnalysisBatch } from "@/services/analyze";
import { generateBrief, sendBrief } from "@/services/brief";
import { ingestAllEnabled } from "@/services/ingest";
import { resolveAll } from "@/services/resolve";
import { saveSnapshots } from "@/services/snapshots";
import { syncYoutube } from "@/services/youtube";

const { jobRuns, podcasts } = schema;

type Detail = Record<string, unknown>;

/** Runs `fn`, records start, finish, status and detail in job_runs, and never throws (cron must always answer). */
async function tracked(job: string, fn: (detail: Detail) => Promise<void>): Promise<{ ok: boolean; detail: Detail }> {
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

// Stay inside the 300 s Vercel limit with headroom.
const BUDGET_MS = 240_000;

/** Daily: collect new episodes, analyse them, refresh entities, scores and any unsent brief. Safe to run repeatedly. */
export function runDaily() {
  return tracked("daily", async (d) => {
    const started = Date.now();
    const ingest = await ingestAllEnabled(14);
    d.ingest = { podcasts: ingest.length, newEpisodes: ingest.reduce((a, r) => a + r.inserted, 0), failed: ingest.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`) };

    const withChannel = await db.select().from(podcasts).where(eq(podcasts.enabled, true));
    let matched = 0;
    for (const p of withChannel.filter((x) => x.youtubeChannelId)) {
      const r = await syncYoutube(p, 14);
      matched += r.matched;
      if (r.error) ((d.youtubeErrors as string[]) ??= []).push(`${p.name}: ${r.error}`);
    }
    d.youtubeMatched = matched;

    d.queued = await enqueueAnalysis();
    let processed = 0;
    while (Date.now() - started < BUDGET_MS) {
      const s = await runAnalysisBatch(20, 4);
      if (s.claimed === 0) break;
      processed += s.claimed;
    }
    d.analysed = processed;
    d.queue = await analysisProgress();

    d.resolved = await resolveAll();
    d.snapshot = await saveSnapshots();

    // Retry a brief that failed to send earlier this week.
    const [latest] = await db.select().from(schema.weeklyReports).orderBy(desc(schema.weeklyReports.weekStart)).limit(1);
    if (latest?.emailStatus === "failed") d.briefRetry = await sendBrief({ reportId: latest.id });
  });
}

/** Weekly (Monday morning IST): build the brief from current data and email it. */
export function runWeekly(opts: { force?: boolean } = {}) {
  return tracked("weekly", async (d) => {
    const gen = await generateBrief({ force: opts.force });
    d.brief = gen;
    d.email = await sendBrief({ reportId: gen.id, force: opts.force });
  });
}

export async function recentRuns(limit = 10) {
  return db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit);
}
