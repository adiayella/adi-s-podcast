import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withYoutubeBudget } from "@/lib/api-budget";
import { effortBudget, isDue } from "@/research/config";
import { analysisProgress, enqueueAnalysis, runAnalysisBatch } from "@/services/analyze";
import { generatedBeforeWeekEnded, reportWeekStart } from "@/lib/weeks";
import { checkDelivery, checkPendingDeliveries, generateBrief, sendBrief } from "@/services/brief";
import { checkReadiness } from "@/services/readiness";
import { buildAudienceThemes, runAudienceAnalysis } from "@/services/audience";
import { scoreOpportunities } from "@/services/intelligence";
import { ensureDrafts } from "@/services/outreach";
import { buildClusters, embedMissingEpisodes } from "@/services/semantic";
import { discoverCore } from "@/services/discovery";
import { ingestAllEnabled } from "@/services/ingest";
import { lastRealRun, tracked } from "@/services/job-log";
import { getActiveConfig } from "@/services/research-settings";
import { resolveAll } from "@/services/resolve";
import { saveSnapshots } from "@/services/snapshots";
import { repairEpisodeLinks } from "@/services/spotify-links";
import { runSpotifyTrends } from "@/services/spotify-trends";
import { syncYoutube } from "@/services/youtube";
import { fetchPendingTranscripts } from "@/transcripts/fetch";

export { recentRuns } from "@/services/job-log";

const { podcasts } = schema;

// Stay inside the 300 s Vercel limit with headroom.
const BUDGET_MS = 240_000;

/**
 * Focused Research: monitor the founder's podcast watchlist. Reads the research settings at run time, so a
 * changed priority list, frequency, date range or mode switch applies to the very next run. Safe to repeat.
 */
export function runFocused(opts: { force?: boolean; budgetMs?: number } = {}) {
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

    // Transcript enrichment: download transcripts feeds publish (rights gate applied), which sends those episodes
    // back for analysis at transcript level. Episodes without one simply stay metadata-only.
    d.transcripts = await fetchPendingTranscripts({ limit: 25 });

    d.queued = await enqueueAnalysis();
    let processed = 0;
    while (Date.now() - started < (opts.budgetMs ?? BUDGET_MS)) {
      const s = await runAnalysisBatch(20, 4);
      if (s.claimed === 0) break;
      processed += s.claimed;
    }
    d.analysed = processed;
    d.queue = await analysisProgress();
    d.resolved = await resolveAll();
    d.snapshot = await saveSnapshots();

    // Phase 2 enrichment. Each step is optional: a failure is recorded and never blocks the data the Monday brief needs.
    const optional = async <T>(name: string, fn: () => Promise<T>) => {
      try {
        d[name] = await fn();
      } catch (e) {
        d[name] = { error: e instanceof Error ? e.message.slice(0, 160) : String(e) };
      }
    };
    await optional("spotifyLinks", () => repairEpisodeLinks());
    await optional("semantic", async () => ({ ...(await embedMissingEpisodes()), ...(await buildClusters()) }));
    await optional("opportunities", () => scoreOpportunities());
    await optional("audience", async () => ({ ...(await runAudienceAnalysis({ maxVideos: 4 })), ...(await buildAudienceThemes()) }));

    d.briefRetry = await retryBrief();
  });
}

/**
 * Housekeeping that runs every day, so a Monday brief that failed part-way is repaired within a day: regenerate if
 * generation failed, re-send if sending failed, and re-ask the provider about any delivery that is not final yet.
 */
export async function retryBrief() {
  const out: Record<string, unknown> = {};
  const [latest] = await db.select().from(schema.weeklyReports).orderBy(desc(schema.weeklyReports.weekStart)).limit(1);
  if (latest) {
    if (latest.generationStatus !== "ready") {
      out.regenerated = await generateBrief({ weekStart: latest.weekStart, force: true }).catch((e) => ({ error: String(e) }));
    }
    if (latest.sendStatus === "failed" || latest.sendStatus === "sending") out.resent = await sendBrief({ weekStart: latest.weekStart });
  }
  out.delivery = await checkPendingDeliveries();
  return out;
}

/** Discovery Research: look for new podcasts and opportunities outside the watchlist. Never changes the watchlist itself. */
export function runDiscovery(opts: { force?: boolean } = {}) {
  return tracked("discovery", async (d) => {
    const started = Date.now();
    await discoverCore(d, opts);
    // Spotify trend scan by sector. Optional: a failure is recorded and never blocks discovery.
    try {
      d.spotifyTrends = await runSpotifyTrends({ force: opts.force, budgetMs: Math.max(0, BUDGET_MS - (Date.now() - started)) });
    } catch (e) {
      d.spotifyTrends = { error: e instanceof Error ? e.message.slice(0, 160) : String(e) };
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Weekly (Monday ~07:00 IST): make sure ingestion and analysis are complete, write the brief for the week that just
 * ended, email it, then ask the provider whether it was delivered. Every step is safe to repeat, so a retry cannot
 * produce a second email. Failures are recorded on the report and the job, never hidden.
 */
export function runWeekly(opts: { force?: boolean; now?: Date; deliveryWaitMs?: number } = {}) {
  return tracked("weekly", async (d) => {
    const weekStart = reportWeekStart(opts.now);
    d.weekStart = weekStart;

    const [existing] = await db.select().from(schema.weeklyReports).where(eq(schema.weeklyReports.weekStart, weekStart));
    // A brief made before this week was over (an early or test run) is incomplete: rebuild and send it once now.
    const premature = generatedBeforeWeekEnded(existing?.generatedAt, weekStart);
    if (premature) d.rebuilt = "The stored brief was generated before the week ended; rebuilding it with the full week";
    const redo = Boolean(opts.force) || premature;
    if (existing?.sendStatus === "accepted" && !redo) {
      d.skipped = "This week's brief was already sent";
      d.delivery = await checkPendingDeliveries();
      return;
    }

    // 1. Ingestion and analysis must be complete first. If they are not, finish them now (bounded), then re-check.
    let ready = await checkReadiness(opts.now);
    if (!ready.ready) {
      d.catchUp = (await runFocused({ force: true, budgetMs: 120_000 })).ok;
      ready = await checkReadiness(opts.now);
    }
    d.readiness = ready;

    // Fresh scores and draft emails for the top targets, so the brief can say who to contact and what to send. Drafts only.
    try {
      d.opportunities = await scoreOpportunities(opts.now);
      d.drafts = await ensureDrafts();
    } catch (e) {
      d.draftError = e instanceof Error ? e.message.slice(0, 160) : String(e);
    }

    // 2. Generate (reuses an existing ready brief for the week).
    const gen = await generateBrief({ force: redo, weekStart, now: opts.now, dataNotes: ready.ready ? [] : ready.notes });
    d.brief = gen;

    // 3. Send, with a few spaced retries for transient provider errors.
    let sent: Awaited<ReturnType<typeof sendBrief>> = { sent: false, reason: "not attempted" };
    for (const wait of [0, 4_000, 12_000]) {
      if (wait) await sleep(wait);
      sent = await sendBrief({ reportId: gen.id, force: redo });
      if (sent.sent || sent.reason === "Already sent" || sent.reason?.includes("not configured")) break;
    }
    d.email = sent;

    // 4. Ask the provider what happened. "accepted" is not "delivered": this records the provider's own answer.
    if (sent.sent) {
      await sleep(opts.deliveryWaitMs ?? 8_000);
      d.delivery = await checkDelivery(gen.id);
    }
    if (!sent.sent && sent.reason !== "Already sent") throw new Error(`Brief was generated but not sent: ${sent.reason}`);
  });
}
