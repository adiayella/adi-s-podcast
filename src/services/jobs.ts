import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withYoutubeBudget } from "@/lib/api-budget";
import { effortBudget, isDue } from "@/research/config";
import { analysisProgress, enqueueAnalysis, runAnalysisBatch } from "@/services/analyze";
import { generateBrief, sendBrief } from "@/services/brief";
import { discoverCore } from "@/services/discovery";
import { ingestAllEnabled } from "@/services/ingest";
import { lastRealRun, tracked } from "@/services/job-log";
import { getActiveConfig } from "@/services/research-settings";
import { resolveAll } from "@/services/resolve";
import { saveSnapshots } from "@/services/snapshots";
import { syncYoutube } from "@/services/youtube";

export { recentRuns } from "@/services/job-log";

const { podcasts } = schema;

// Stay inside the 300 s Vercel limit with headroom.
const BUDGET_MS = 240_000;

/**
 * Focused Research: monitor the founder's podcast watchlist. Reads the research settings at run time, so a
 * changed priority list, frequency, date range or mode switch applies to the very next run. Safe to repeat.
 */
export function runFocused(opts: { force?: boolean } = {}) {
  return tracked("focused", async (d) => {
    const started = Date.now();
    const { version, config } = await getActiveConfig();
    d.settingsVersion = version;
    if (!config.modes.focused.enabled) {
      d.skipped = "Focused mode is switched off";
      return;
    }
    if (!opts.force && !isDue(config.frequency.focused, await lastRealRun("focused"))) {
      d.skipped = `Not due yet (runs ${config.frequency.focused})`;
      return;
    }
    d.priorityShows = config.priorityPodcastIds.length;

    const ingest = await ingestAllEnabled(14, config.priorityPodcastIds);
    d.ingest = { podcasts: ingest.length, newEpisodes: ingest.reduce((a, r) => a + r.inserted, 0), failed: ingest.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`) };

    // YouTube enrichment, metered so its quota use is recorded next to discovery's
    const limit = Math.max(300, effortBudget(config).focusedYoutubeUnits);
    const monitored = await db.select().from(podcasts).where(eq(podcasts.enabled, true));
    let matched = 0;
    const yt = await withYoutubeBudget(limit, async () => {
      for (const p of monitored.filter((x) => x.youtubeChannelId)) {
        const r = await syncYoutube(p, 14);
        matched += r.matched;
        if (r.error) ((d.youtubeErrors as string[]) ??= []).push(`${p.name}: ${r.error}`);
      }
    });
    d.youtubeMatched = matched;
    d.youtubeUnits = yt.spent;

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

/** Discovery Research: look for new podcasts and opportunities outside the watchlist. Never changes the watchlist itself. */
export function runDiscovery(opts: { force?: boolean } = {}) {
  return tracked("discovery", (d) => discoverCore(d, opts));
}

/** Weekly (Monday morning IST): build the brief from current data and email it. */
export function runWeekly(opts: { force?: boolean } = {}) {
  return tracked("weekly", async (d) => {
    const gen = await generateBrief({ force: opts.force });
    d.brief = gen;
    d.email = await sendBrief({ reportId: gen.id, force: opts.force });
  });
}
