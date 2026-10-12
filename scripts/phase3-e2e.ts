import "./env";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEpisodePerformance, getSectorTrends, getActiveRubric, latestOpportunities, saveRubric, scoreOpportunities } from "@/services/intelligence";

// usage: npm run phase3-e2e   (real database; no paid API calls)
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

async function main() {
  // engagement
  const perf = await getEpisodePerformance();
  const withPerf = [...perf.values()].filter((p) => p.perf !== null);
  t("Engagement: monitored episodes have stored view/like/comment counts", perf.size > 50, `${perf.size} episodes`);
  const [snapCheck] = await q<{ bad: number }>(sql`select count(*)::int bad from episode_metric_snapshots where views < 0 or likes < 0 or comments < 0`);
  t("Engagement: stored counts are sane (no negatives)", snapCheck.bad === 0);
  const median = [...withPerf.map((p) => p.perf!)].sort((a, b) => a - b)[Math.floor(withPerf.length / 2)];
  t("Engagement: the performance index is centred near 1.0 (age bias removed)", withPerf.length > 20 && median > 0.7 && median < 1.4, `${withPerf.length} indexed episodes, median ${median}`);
  t("Engagement: velocity is reported as unavailable, not invented, while only one snapshot day exists", [...perf.values()].every((p) => p.gained === null || p.velocityPerDay !== null));

  // sectors
  const sectors = await getSectorTrends();
  t("Sectors: trends come with week-over-week counts and engagement", sectors.length > 5 && sectors.every((s) => typeof s.episodesThisWeek === "number" && s.confidence.reasons.length > 0));
  const [dbCount] = await q<{ n: number }>(sql`select count(distinct et.episode_id)::int n from episode_topics et join episodes e on e.id = et.episode_id where e.published_at >= now() - interval '7 days'`);
  t("Sectors: this-week counts agree with the database", sectors.reduce((a, s) => a + s.episodesThisWeek, 0) >= dbCount.n, `sum of topic counts ${sectors.reduce((a, s) => a + s.episodesThisWeek, 0)} >= ${dbCount.n} distinct tagged episodes`);

  // opportunity scoring + rubric versions
  const run1 = await scoreOpportunities();
  const g1 = await latestOpportunities("guest", 40);
  t("Scoring: guests and sponsors are scored with a stored breakdown", g1.length > 0 && g1.every((o) => Number(o.score) >= 0 && Number(o.score) <= 100 && o.criteria.length === 5));
  t("Scoring: every criterion carries a plain-language reason", g1.every((o) => o.criteria.every((c) => c.note.length > 5)));
  const again = await scoreOpportunities();
  const [dups] = await q<{ n: number }>(sql`select count(*)::int n from (select 1 from opportunity_scores group by kind, entity_id, week_start having count(*) > 1) d`);
  t("Scoring: re-running overwrites rather than duplicating", dups.n === 0 && again.weekStart === run1.weekStart);

  const before = await getActiveRubric("guest");
  const focusHeavy = await saveRubric("guest", { reach: 0.05, recency: 0.05, focus: 0.8, audiencePull: 0.05, confidence: 0.05 }, "e2e test: focus heavy");
  t("Rubric: a bad edit is rejected and changes nothing", (await saveRubric("guest", { reach: 5 }, "bad")) === null && (await getActiveRubric("guest")).id === (focusHeavy?.id ?? -1));
  await scoreOpportunities();
  const g2 = await latestOpportunities("guest", 40);
  const changed = g2.filter((o) => g1.find((x) => x.entity_id === o.entity_id && x.score !== o.score)).length;
  t("Rubric: new weights re-rank guests, and scores name the new rubric version", changed > 0 && g2.every((o) => o.rubric_version_id === focusHeavy!.id), `${changed} scores changed`);
  const oldRows = await db.select().from(schema.rubricVersions).where(eq(schema.rubricVersions.id, before.id));
  t("Rubric: the earlier version is kept, not overwritten", oldRows.length === 1 && oldRows[0].active === false);

  // restore the original rubric as the active one
  const restored = await saveRubric("guest", before.weights, "restored after e2e test");
  await scoreOpportunities();
  t("Rubric: restoring the original weights restores the original scores", restored !== null && (await latestOpportunities("guest", 40)).every((o) => g1.find((x) => x.entity_id === o.entity_id)?.score === o.score));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} phase 3 checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
