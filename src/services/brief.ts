import { eq, sql } from "drizzle-orm";
import { Resend } from "resend";
import { db, schema } from "@/db";
import { buildBriefStats, type BriefStats } from "./brief-stats";
import { writeNarrative, type Narrative } from "./brief-narrative";
import { buildBriefDoc, toHtml, toMarkdown, toText } from "./brief-render";
import { currentWeekStartIST } from "./snapshots";

const { weeklyReports } = schema;

export type StoredReport = { stats: BriefStats; narrative: Narrative | null; meta: { model: string; dropped: string[]; narrativeError?: string; emailError?: string; emailId?: string } };

export async function getRecipient(): Promise<string | null> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, "briefRecipient"));
  const fromDb = typeof row?.value === "string" ? row.value : null;
  return fromDb || process.env.BRIEF_TO_EMAIL || null;
}

/**
 * Build this week's brief: SQL facts first, Gemini commentary second, then store it.
 * Idempotent per week: re-running overwrites the draft, and a brief that was already emailed is left alone unless forced.
 */
export async function generateBrief(opts: { force?: boolean } = {}) {
  const weekStart = currentWeekStartIST();
  const [existing] = await db.select().from(weeklyReports).where(eq(weeklyReports.weekStart, weekStart));
  if (existing?.emailStatus === "sent" && !opts.force) return { id: existing.id, weekStart, regenerated: false, status: existing.emailStatus };

  const stats = await buildBriefStats(weekStart);
  const { narrative, dropped, model, error } = await writeNarrative(stats);
  const doc = buildBriefDoc(stats, narrative);
  const stored: StoredReport = { stats, narrative, meta: { model, dropped, ...(error ? { narrativeError: error } : {}) } };

  const [row] = await db
    .insert(weeklyReports)
    .values({ weekStart, statsJson: stored, briefMarkdown: toMarkdown(doc), emailStatus: "pending" })
    .onConflictDoUpdate({
      target: weeklyReports.weekStart,
      set: { statsJson: stored, briefMarkdown: toMarkdown(doc), emailStatus: "pending", emailedAt: null },
    })
    .returning({ id: weeklyReports.id });
  return { id: row.id, weekStart, regenerated: true, status: "pending", narrativeError: error, dropped };
}

/** Email the stored brief through Resend. A brief already marked sent is never re-sent unless forced. */
export async function sendBrief(opts: { reportId?: number; force?: boolean } = {}) {
  const weekStart = currentWeekStartIST();
  const [report] = opts.reportId
    ? await db.select().from(weeklyReports).where(eq(weeklyReports.id, opts.reportId))
    : await db.select().from(weeklyReports).where(eq(weeklyReports.weekStart, weekStart));
  if (!report) return { sent: false, reason: "No brief has been generated for this week" };
  if (report.emailStatus === "sent" && !opts.force) return { sent: false, reason: "Already sent" };

  const to = await getRecipient();
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) return markFailed(report.id, report.statsJson as StoredReport, "Email is not configured (RESEND_API_KEY / BRIEF_TO_EMAIL)");

  const stored = report.statsJson as StoredReport;
  const doc = buildBriefDoc(stored.stats, stored.narrative);
  const base = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
  const { data, error } = await new Resend(key).emails.send({
    from: process.env.RESEND_FROM || "Podcast Radar <onboarding@resend.dev>",
    to: [to],
    subject: doc.subject,
    html: toHtml(doc, base ? `${base}/brief` : undefined),
    text: toText(doc),
  });
  if (error || !data) return markFailed(report.id, stored, error?.message ?? "Resend returned no id");

  await db
    .update(weeklyReports)
    .set({ emailStatus: "sent", emailedAt: new Date(), statsJson: { ...stored, meta: { ...stored.meta, emailId: data.id, emailError: undefined } } })
    .where(eq(weeklyReports.id, report.id));
  return { sent: true, to, emailId: data.id };
}

async function markFailed(id: number, stored: StoredReport, message: string) {
  await db
    .update(weeklyReports)
    .set({ emailStatus: "failed", statsJson: { ...stored, meta: { ...stored.meta, emailError: message } } })
    .where(eq(weeklyReports.id, id));
  return { sent: false, reason: message };
}

export async function latestReports(limit = 8) {
  return db.select().from(weeklyReports).orderBy(sql`${weeklyReports.weekStart} desc`).limit(limit);
}
