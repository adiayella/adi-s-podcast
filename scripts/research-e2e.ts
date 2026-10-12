import "./env";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DEFAULT_CONFIG } from "@/research/config";
import { generateBrief } from "@/services/brief";
import { approveCandidate, setCandidateStatus } from "@/services/discovery-review";
import { getFocusContext } from "@/services/focus-context";
import { runDiscovery, runFocused } from "@/services/jobs";
import { getGuestRadar, parsePeriod } from "@/services/radars";
import { getActiveConfig, listVersions, restoreVersion, saveConfig } from "@/services/research-settings";

// usage: npm run research-e2e
// Exercises the research modes against the real database and restores the founder's settings afterwards.
// Sends no email (the email path is tested separately through the weekly cron endpoint).

type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
const t = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
};

async function counts() {
  const r = (await db.execute(sql`select (select count(*) from episodes)::int eps, (select count(*) from guests)::int guests, (select count(*) from brands)::int brands,
    (select count(*) from guest_appearances)::int apps, (select count(*) from sponsor_evidence)::int ev, (select count(*) from analysis_jobs)::int jobs,
    (select count(*) from podcasts)::int podcasts, (select count(*) from podcasts where enabled)::int enabled`)) as unknown as { rows?: Record<string, number>[] } | Record<string, number>[];
  return (Array.isArray(r) ? r : r.rows!)[0];
}

async function main() {
  const start = await getActiveConfig();
  const base = start.config;

  // ---------------------------------------------------------------- 1. preferences: validation, versioning, restore
  const bad = await saveConfig({ ...base, effort: { focused: 80, discovery: 30 } });
  t("Prefs: effort that does not total 100% is rejected", !bad.ok, bad.ok ? "" : bad.error);
  const badTopic = await saveConfig({ ...base, categories: ["Cooking"] });
  t("Prefs: unknown category is rejected", !badTopic.ok);
  const same = await saveConfig(base);
  t("Prefs: saving unchanged settings creates no new version", same.ok && !same.changed && same.version === start.version, `still v${start.version}`);
  const edited = await saveConfig({ ...base, keywords: [...base.keywords, "e2e-test-keyword"], excludedTopics: ["Real Estate"] }, "e2e test edit");
  t("Prefs: an edit is saved as a NEW version", edited.ok && edited.changed && edited.version === start.version + 1, edited.ok ? `v${edited.version}` : edited.error);
  const afterEdit = await getActiveConfig();
  t("Prefs: the active settings reflect the edit immediately", afterEdit.config.keywords.includes("e2e-test-keyword") && afterEdit.config.excludedTopics.includes("Real Estate"));
  const versions = await listVersions(20);
  t("Prefs: version history keeps the old version untouched", versions.some((v) => v.version === start.version && !JSON.stringify(v.config).includes("e2e-test-keyword")));

  // ---------------------------------------------------------------- 2. each mode can be switched off and on
  await saveConfig({ ...afterEdit.config, modes: { focused: { enabled: false }, discovery: { enabled: true } } }, "e2e: focused off");
  const f = await runFocused();
  t("Mode: Focused switched off -> the focused job skips", Boolean(f.detail.skipped) && String(f.detail.skipped).includes("off"), String(f.detail.skipped));
  await saveConfig({ ...afterEdit.config, modes: { focused: { enabled: true }, discovery: { enabled: false } } }, "e2e: discovery off");
  const d = await runDiscovery({ force: true });
  t("Mode: Discovery switched off -> the discovery job skips, even when forced", Boolean(d.detail.skipped) && String(d.detail.skipped).includes("off"), String(d.detail.skipped));

  // ---------------------------------------------------------------- 3. frequency is honoured
  await saveConfig({ ...afterEdit.config, frequency: { focused: "weekly", discovery: "weekly" } }, "e2e: weekly");
  const due = await runFocused(); // the focused job ran earlier today, so a weekly job is not due
  t("Frequency: a weekly job that ran recently is skipped as not due", String(due.detail.skipped ?? "").includes("Not due"), String(due.detail.skipped));

  // ---------------------------------------------------------------- 4. preferences change what the NEXT discovery job does
  const probe = "zzq-e2e-unlikely-term";
  await saveConfig({ ...afterEdit.config, keywords: [probe], categories: [], priorityTopics: [], modes: { focused: { enabled: true }, discovery: { enabled: true } }, effort: { focused: 100, discovery: 0 } }, "e2e: zero discovery effort");
  const zero = await runDiscovery({ force: true });
  const zb = zero.detail.budget as { maxSearchTerms: number; discoveryYoutubeUnits: number };
  t("Effort: 0% discovery effort -> no new searches and no YouTube units", zb.maxSearchTerms === 0 && zb.discoveryYoutubeUnits === 0 && !zero.detail.appleSearches && !zero.detail.youtubeUnitsSpent, JSON.stringify(zb));
  t("Preferences: the next job uses the NEW search terms", (zero.detail.terms as string[])[0] === probe, String((zero.detail.terms as string[])[0]));

  // ---------------------------------------------------------------- 5. exclusions change the monitored radars
  const g1 = await getGuestRadar({ period: parsePeriod("90d"), includeJournalists: true });
  const sample = g1.find((g) => g.name === "Saurabh Mukherjea");
  await saveConfig({ ...afterEdit.config, excludedKeywords: ["Mukherjea"], effort: { focused: 70, discovery: 30 } }, "e2e: exclude keyword");
  const g2 = await getGuestRadar({ period: parsePeriod("90d"), includeJournalists: true });
  t("Exclusions: an excluded keyword removes matching episodes from the Guest Radar", Boolean(sample) && !g2.some((g) => g.name === "Saurabh Mukherjea") && g2.length < g1.length, `${g1.length} guests -> ${g2.length}`);
  const ctx = await getFocusContext();
  t("Exclusions: the focus context lists the excluded episodes", ctx.excluded.size > 0, `${ctx.excluded.size} excluded`);

  // restore sensible settings for the discovery tests below
  await saveConfig({ ...base, keywords: base.keywords, modes: { focused: { enabled: true }, discovery: { enabled: true } } }, "e2e: back to normal");

  // ---------------------------------------------------------------- 6. discovery never touches the monitored universe
  const before = await counts();
  const run = await runDiscovery({ force: true });
  const after = await counts();
  t("Discovery: the job runs", run.ok, run.ok ? `${run.detail.feedsFetched ?? 0} feeds, ${run.detail.candidatesKept ?? 0} kept` : String(run.detail.error));
  const same2 = ["eps", "guests", "brands", "apps", "ev", "jobs", "podcasts", "enabled"].every((k) => before[k] === after[k]);
  t("Separation: a discovery run leaves every monitored table unchanged", same2, same2 ? "episodes, guests, brands, evidence, jobs, podcasts all identical" : JSON.stringify({ before, after }));
  const leaked = (await db.execute(sql`select count(*)::int n from discovery_candidates c join podcasts p on p.rss_url = c.rss_url where c.status <> 'approved'`)) as unknown as { rows?: { n: number }[] } | { n: number }[];
  t("Separation: no un-approved candidate is on the watchlist (nothing is auto-added)", Number((Array.isArray(leaked) ? leaked : leaked.rows!)[0].n) === 0);

  // ---------------------------------------------------------------- 7. review queue decisions
  const [cand] = await db.select().from(schema.discoveryCandidates).where(sql`status = 'new' and rss_url is not null`).limit(1);
  if (!cand) {
    t("Review: a real candidate is available to review", false, "no candidates; run discovery first");
  } else {
    const dis = await setCandidateStatus(cand.id, "dismissed");
    t("Review: dismiss", dis.ok && (await status(cand.id)) === "dismissed");
    await runDiscovery({ force: true });
    t("Review: a dismissed show is not suggested again", (await status(cand.id)) === "dismissed");
    await setCandidateStatus(cand.id, "saved");
    t("Review: save for later", (await status(cand.id)) === "saved");
    await setCandidateStatus(cand.id, "excluded");
    t("Review: exclude a source from future suggestions", (await status(cand.id)) === "excluded");
    await setCandidateStatus(cand.id, "new");
    const pods = (await counts()).podcasts;
    const ap = await approveCandidate(cand.id);
    const nowCounts = await counts();
    t("Review: approve adds the show to the watchlist", ap.ok && nowCounts.podcasts === pods + 1 && (await status(cand.id)) === "approved", ap.ok ? ap.message : ap.error);
    // clean up: remove the approved podcast again and put the candidate back in the queue
    const [row] = await db.select().from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.id, cand.id));
    if (row?.promotedPodcastId) await db.delete(schema.podcasts).where(eq(schema.podcasts.id, row.promotedPodcastId));
    await db.update(schema.discoveryCandidates).set({ status: "new", promotedPodcastId: null, decidedAt: null }).where(eq(schema.discoveryCandidates.id, cand.id));
    t("Review: test cleanup restored the watchlist", (await counts()).podcasts === pods);
  }

  // ---------------------------------------------------------------- 8. brief with both sections, independent logs
  const gen = await generateBrief({ force: true });
  const [rep] = await db.select().from(schema.weeklyReports).where(eq(schema.weeklyReports.id, gen.id));
  const md = rep.briefMarkdown;
  t("Brief: has a Focused Intelligence section", md.includes("# Focused Intelligence"));
  t("Brief: has a Discovery Opportunities section", md.includes("# Discovery Opportunities"));
  t("Brief: each section states its source universe", md.includes("Source: 10 monitored podcasts") && md.includes("NOT on your watchlist"));
  const logs = (await db.execute(sql`select job, count(*)::int n from job_runs where job in ('focused', 'discovery') group by job`)) as unknown as { rows?: { job: string; n: number }[] } | { job: string; n: number }[];
  const jobs = new Set((Array.isArray(logs) ? logs : logs.rows!).map((x) => x.job));
  t("Logs: Focused and Discovery runs are logged independently", jobs.has("focused") && jobs.has("discovery"), [...jobs].join(", "));

  // ---------------------------------------------------------------- restore the founder's settings
  const back = await restoreVersion(start.version);
  const final = await getActiveConfig();
  t("Cleanup: original settings restored", back.ok && JSON.stringify(final.config) === JSON.stringify(base), `active is v${final.version}, same content as v${start.version}`);
  void DEFAULT_CONFIG;

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} end-to-end checks passed`);
  process.exit(failed.length ? 1 : 0);
}

async function status(id: number) {
  const [r] = await db.select({ s: schema.discoveryCandidates.status }).from(schema.discoveryCandidates).where(eq(schema.discoveryCandidates.id, id));
  return r?.s;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
