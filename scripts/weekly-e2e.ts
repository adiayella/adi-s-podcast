import "./env";
import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, istClock, reportWeekStart, weekRange } from "@/lib/weeks";
import { checkDelivery, generateBrief, latestReports, sendBrief, type StoredReport } from "@/services/brief";
import { isFinalDelivery, type DeliveryStatus } from "@/services/delivery";
import { runWeekly } from "@/services/jobs";

// usage: npm run weekly-e2e
// Exercises the Monday-email pipeline against the REAL database and the REAL email provider. It sends at most two emails,
// both to the authorised test inbox (Resend test mode only delivers there), and removes its synthetic reports afterwards.
type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
const t = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
};
const { weeklyReports } = schema;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function count(q: ReturnType<typeof sql>) {
  const r = (await db.execute(q)) as unknown as { rows?: { n: number }[] } | { n: number }[];
  return Number((Array.isArray(r) ? r : (r.rows ?? []))[0]?.n ?? 0);
}

async function main() {
  const real = reportWeekStart();
  const synthA = addDays(real, -21); // synthetic weeks inside the data window; removed at the end
  const synthB = addDays(real, -28);

  // ---------------------------------------------------------------- 1. schedule and week boundaries
  const cron = JSON.parse(readFileSync("vercel.json", "utf8")).crons.find((c: { path: string }) => c.path === "/api/cron/weekly").schedule as string;
  const [min, hr, , , dow] = cron.split(" ").map(Number);
  const fire = new Date(Date.UTC(2026, 9, 12, hr, min)); // a Monday
  const ist = istClock(fire);
  t("Schedule: the weekly cron fires Monday 07:00 IST (UTC conversion is correct)", dow === 1 && ist.weekday === 1 && ist.hour === 7 && ist.minute === 0, `cron "${cron}" = ${String(ist.hour).padStart(2, "0")}:${String(ist.minute).padStart(2, "0")} IST`);
  t("Window: the brief reports the previous completed Monday-Sunday week", reportWeekStart(fire) === "2026-10-05" && new Date(`${real}T00:00:00Z`).getUTCDay() === 1, `reporting ${real} to ${addDays(real, 6)}`);

  // ---------------------------------------------------------------- 2. Gemini outage: still produces a data-only brief
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const outage = await generateBrief({ weekStart: synthA, force: true });
  process.env.GEMINI_API_KEY = savedKey;
  const [rowA0] = await db.select().from(weeklyReports).where(eq(weeklyReports.weekStart, synthA));
  const storedA = rowA0.statsJson as StoredReport;
  t("Failure: with Gemini unavailable the brief is still generated from the data, and says so", rowA0.generationStatus === "ready" && storedA.narrative === null && Boolean(storedA.meta.narrativeError) && rowA0.briefMarkdown.includes("AI commentary was unavailable"), `narrativeError: ${String(outage.narrativeError).slice(0, 60)}`);

  // ---------------------------------------------------------------- 3. send failure, then recovery and race
  const savedResend = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_invalid_key_for_failure_test";
  const failed = await sendBrief({ reportId: rowA0.id });
  process.env.RESEND_API_KEY = savedResend;
  const [rowA1] = await db.select().from(weeklyReports).where(eq(weeklyReports.id, rowA0.id));
  t("Failure: a rejected send is recorded as failed with the provider's reason, never as sent", !failed.sent && rowA1.sendStatus === "failed" && Boolean(rowA1.sendError) && rowA1.deliveryStatus === "unknown", `${rowA1.sendStatus}: ${String(rowA1.sendError).slice(0, 70)}`);

  const race = await Promise.all([sendBrief({ reportId: rowA0.id }), sendBrief({ reportId: rowA0.id }), sendBrief({ reportId: rowA0.id })]);
  const [rowA2] = await db.select().from(weeklyReports).where(eq(weeklyReports.id, rowA0.id));
  t("Duplicates: three simultaneous sends produce exactly one email", race.filter((r) => r.sent).length === 1 && rowA2.sendStatus === "accepted" && Boolean(rowA2.providerEmailId), `${race.filter((r) => r.sent).length} sent; others: ${race.filter((r) => !r.sent).map((r) => r.reason).join(" | ")}`);
  t("Retry: a retry after a failure succeeds and counts as a new attempt", rowA2.sendAttempts === 2, `${rowA2.sendAttempts} attempts`);
  const again = await sendBrief({ reportId: rowA0.id });
  t("Duplicates: asking again after it was sent does nothing", !again.sent && again.reason === "Already sent");

  // ---------------------------------------------------------------- 4. the real scheduled run, end to end
  await db.delete(weeklyReports).where(eq(weeklyReports.weekStart, real)); // a clean run, as on a fresh Monday
  const run = await runWeekly({ deliveryWaitMs: 10_000 });
  const [row] = await db.select().from(weeklyReports).where(eq(weeklyReports.weekStart, real));
  const stored = row.statsJson as StoredReport;
  t("Scheduled run: the job completed without error", run.ok, run.ok ? "" : String(run.detail.error));
  t("Generation: stored for the previous completed week, status ready", row.generationStatus === "ready" && row.weekStart === real && Boolean(row.generatedAt));
  const range = weekRange(real);
  const epsInWeek = await count(sql`select count(*)::int n from episodes e join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= ${range.from.toISOString()}::timestamptz and e.published_at < ${range.to.toISOString()}::timestamptz`);
  const epsPrev = await count(sql`select count(*)::int n from episodes e join podcasts p on p.id = e.podcast_id and p.enabled where e.published_at >= ${weekRange(addDays(real, -7)).from.toISOString()}::timestamptz and e.published_at < ${range.from.toISOString()}::timestamptz`);
  t("Data: the brief's episode counts match an independent count from Neon, for both weeks", stored.stats.activity?.episodes === epsInWeek && stored.stats.activity?.previousEpisodes === epsPrev, `${epsInWeek} episodes this period vs ${epsPrev} the week before`);
  t("Comparison: the brief states the reporting period and the previous one", row.briefMarkdown.includes("Reporting period:") && row.briefMarkdown.includes(addDays(real, -7)));
  t("Hand-off: accepted by the provider, with a provider message id and recipient recorded", row.sendStatus === "accepted" && Boolean(row.providerEmailId) && Boolean(row.recipient), `to ${row.recipient}, id ${row.providerEmailId?.slice(0, 8)}…`);

  // delivery is whatever the provider says; poll until it is final (up to 90 s)
  let status: DeliveryStatus = "unknown";
  let event = "";
  for (let i = 0; i < 18; i++) {
    const c = await checkDelivery(row.id);
    if (c.checked) {
      status = c.status!;
      event = c.event!;
      if (isFinalDelivery(status)) break;
    }
    await sleep(5_000);
  }
  const [row2] = await db.select().from(weeklyReports).where(eq(weeklyReports.id, row.id));
  t("Delivery: the provider's own status is stored (not inferred from the send call)", row2.deliveryStatus === status && row2.deliveryEvent === event && Boolean(row2.deliveryCheckedAt), `provider last_event = "${event}" -> ${status}`);
  console.log(`      (delivery is ${status === "delivered" ? "CONFIRMED by the provider" : "NOT confirmed: " + status})`);

  // ---------------------------------------------------------------- 5. a second Monday invocation must not send again
  const sentBefore = row2.emailedAt?.getTime();
  const second = await runWeekly({});
  const [row3] = await db.select().from(weeklyReports).where(eq(weeklyReports.weekStart, real));
  t("Duplicates: running the Monday job a second time skips it and sends nothing", second.ok && Boolean(second.detail.skipped) && row3.emailedAt?.getTime() === sentBefore && row3.sendAttempts === row2.sendAttempts, String(second.detail.skipped));

  // ---------------------------------------------------------------- 6. dashboard history
  const hist = await latestReports(12);
  t("History: the new report and its statuses are available to the dashboard", hist.some((h) => h.weekStart === real && h.sendStatus === "accepted"), `${hist.length} reports in history`);

  await db.delete(weeklyReports).where(inArray(weeklyReports.weekStart, [synthA, synthB]));
  const failedChecks = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failedChecks.length}/${results.length} weekly-email checks passed`);
  process.exit(failedChecks.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
