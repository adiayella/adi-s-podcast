import { and, eq, inArray, sql } from "drizzle-orm";
import { Resend } from "resend";
import { db, schema } from "@/db";
import { reportWeekStart } from "@/lib/weeks";
import { buildBriefStats, type BriefStats } from "./brief-stats";
import { writeNarrative, type Narrative } from "./brief-narrative";
import { buildBriefDoc, toHtml, toMarkdown, toText } from "./brief-render";
import { deliveryFromEvent, isFinalDelivery, type DeliveryStatus } from "./delivery";

const { weeklyReports } = schema;

export type StoredReport = { stats: BriefStats; narrative: Narrative | null; meta: { model: string; dropped: string[]; narrativeError?: string; emailError?: string; emailId?: string } };

const DEFAULT_HOUR_IST = 7;

export async function getDeliverySettings(): Promise<{ recipient: string | null; recipientSource: "settings" | "env" | "none"; hourIST: number }> {
  const rows = await db.select().from(schema.settings).where(inArray(schema.settings.key, ["briefRecipient", "briefHourIST"]));
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const fromDb = typeof get("briefRecipient") === "string" ? (get("briefRecipient") as string) : "";
  const hour = Number(get("briefHourIST"));
  const recipient = fromDb || process.env.BRIEF_TO_EMAIL || null;
  return {
    recipient,
    recipientSource: fromDb ? "settings" : process.env.BRIEF_TO_EMAIL ? "env" : "none",
    hourIST: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_HOUR_IST,
  };
}
export async function getRecipient(): Promise<string | null> {
  return (await getDeliverySettings()).recipient;
}

/**
 * Build the brief for a COMPLETED Monday-to-Sunday IST week (the previous one by default): SQL facts first, Gemini
 * commentary second, then store it. Idempotent per week: an existing ready brief is reused (no second Gemini bill on a
 * retry), a brief already handed to the provider is never replaced, and `force` regenerates a draft.
 */
export async function generateBrief(opts: { force?: boolean; weekStart?: string; now?: Date; dataNotes?: string[] } = {}) {
  const weekStart = opts.weekStart ?? reportWeekStart(opts.now);
  const [existing] = await db.select().from(weeklyReports).where(eq(weeklyReports.weekStart, weekStart));
  if (existing?.sendStatus === "accepted" && !opts.force) return { id: existing.id, weekStart, regenerated: false, status: existing.emailStatus, reason: "Already sent" };
  if (existing?.generationStatus === "ready" && !opts.force) return { id: existing.id, weekStart, regenerated: false, status: existing.emailStatus, reason: "Reusing the brief already generated for this week" };

  // Mark the attempt first so a crash mid-way is visible as "generating" rather than silently missing.
  await db
    .insert(weeklyReports)
    .values({ weekStart, statsJson: existing?.statsJson ?? {}, briefMarkdown: existing?.briefMarkdown ?? "", emailStatus: "pending", generationStatus: "generating" })
    .onConflictDoUpdate({ target: weeklyReports.weekStart, set: { generationStatus: "generating", generationError: null } });

  try {
    const stats = await buildBriefStats(weekStart, opts.now);
    if (opts.dataNotes?.length) stats.dataNotes = opts.dataNotes;
    const { narrative, dropped, model, error } = await writeNarrative(stats);
    const doc = buildBriefDoc(stats, narrative);
    const stored: StoredReport = { stats, narrative, meta: { model, dropped, ...(error ? { narrativeError: error } : {}) } };
    const md = toMarkdown(doc);
    const resetSend = existing?.sendStatus === "accepted"; // a forced regeneration of an already-sent brief starts a fresh delivery cycle
    const [row] = await db
      .update(weeklyReports)
      .set({
        statsJson: stored,
        briefMarkdown: md,
        generationStatus: "ready",
        generationError: null,
        generatedAt: new Date(),
        ...(resetSend ? { emailStatus: "pending", emailedAt: null, sendStatus: "not_sent", sendError: null, providerEmailId: null, deliveryStatus: "unknown", deliveryEvent: null, deliveryCheckedAt: null } : {}),
      })
      .where(eq(weeklyReports.weekStart, weekStart))
      .returning({ id: weeklyReports.id, emailStatus: weeklyReports.emailStatus });
    return { id: row.id, weekStart, regenerated: true, status: row.emailStatus, narrativeError: error, dropped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(weeklyReports).set({ generationStatus: "failed", generationError: message }).where(eq(weeklyReports.weekStart, weekStart));
    throw e;
  }
}

/**
 * Hand the stored brief to Resend. Safe to call twice, even at the same moment:
 *  - the row is claimed with a conditional UPDATE, so only one caller can move it to "sending";
 *  - a brief already accepted is never re-sent unless forced;
 *  - the provider is given an idempotency key, so a retry after a crash cannot create a second email.
 * "accepted" means only that Resend took the message; delivery is confirmed separately by checkDelivery().
 */
export async function sendBrief(opts: { reportId?: number; force?: boolean; weekStart?: string } = {}) {
  const weekStart = opts.weekStart ?? reportWeekStart();
  const [report] = opts.reportId
    ? await db.select().from(weeklyReports).where(eq(weeklyReports.id, opts.reportId))
    : await db.select().from(weeklyReports).where(eq(weeklyReports.weekStart, weekStart));
  if (!report) return { sent: false, reason: "No brief has been generated for this week" };
  if (report.generationStatus !== "ready") return { sent: false, reason: `The brief is not ready to send (generation: ${report.generationStatus})` };
  if (report.sendStatus === "accepted" && !opts.force) return { sent: false, reason: "Already sent" };

  const { recipient: to } = await getDeliverySettings();
  const key = process.env.RESEND_API_KEY;
  if (!to || !key) return markFailed(report.id, "Email is not configured (RESEND_API_KEY / BRIEF_TO_EMAIL)");

  // Claim. A previous attempt that died mid-flight ("sending") keeps its attempt number, so its idempotency key is reused.
  // Only one caller can win this UPDATE. A row stuck in "sending" for over 10 minutes is a crashed send and can be taken over.
  const stale = sql`(${weeklyReports.sendStatus} = 'sending' and ${weeklyReports.sendStartedAt} < now() - interval '10 minutes')`;
  const reclaim = opts.force ? sql`(${weeklyReports.sendStatus} <> 'sending' or ${stale})` : sql`(${weeklyReports.sendStatus} in ('not_sent', 'failed') or ${stale})`;
  const [claimed] = await db
    .update(weeklyReports)
    .set({
      sendStatus: "sending",
      sendStartedAt: new Date(),
      sendError: null,
      recipient: to,
      sendAttempts: sql`case when ${weeklyReports.sendStatus} = 'sending' then ${weeklyReports.sendAttempts} else ${weeklyReports.sendAttempts} + 1 end`,
    })
    .where(and(eq(weeklyReports.id, report.id), reclaim))
    .returning({ attempts: weeklyReports.sendAttempts, was: weeklyReports.sendStatus });
  if (!claimed) return { sent: false, reason: "Another send is already in progress or finished" };

  const stored = report.statsJson as StoredReport;
  const doc = buildBriefDoc(stored.stats, stored.narrative);
  const base = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
  try {
    const { data, error } = await new Resend(key).emails.send(
      {
        from: process.env.RESEND_FROM || "Podcast Radar <onboarding@resend.dev>",
        to: [to],
        subject: doc.subject,
        html: toHtml(doc, base ? `${base}/brief` : undefined),
        text: toText(doc),
      },
      // The key changes whenever the brief is regenerated (its body changes) or the attempt number moves on, and stays the
      // same for a crash-and-retry of the identical message, which is the only case where the provider must dedupe.
      { idempotencyKey: `brief-${report.weekStart}-${to}-g${report.generatedAt?.getTime() ?? 0}-a${claimed.attempts}${opts.force ? "-force" : ""}` },
    );
    if (error || !data) return markFailed(report.id, error?.message ?? "Resend returned no id");
    await db
      .update(weeklyReports)
      .set({
        emailStatus: "sent", // legacy summary column: the provider accepted it
        sendStatus: "accepted",
        emailedAt: new Date(),
        providerEmailId: data.id,
        deliveryStatus: "unknown",
        deliveryEvent: null,
        deliveryCheckedAt: null,
        statsJson: { ...stored, meta: { ...stored.meta, emailId: data.id, emailError: undefined } },
      })
      .where(eq(weeklyReports.id, report.id));
    return { sent: true, to, emailId: data.id };
  } catch (e) {
    return markFailed(report.id, e instanceof Error ? e.message : String(e));
  }
}

async function markFailed(id: number, message: string) {
  await db.update(weeklyReports).set({ emailStatus: "failed", sendStatus: "failed", sendError: message }).where(eq(weeklyReports.id, id));
  return { sent: false, reason: message };
}

/**
 * Ask Resend what happened to an accepted email (GET /emails/{id}, field last_event) and store it. This is the only
 * place a brief becomes "delivered". Returns the provider's own answer, never a guess.
 */
export async function checkDelivery(reportId: number): Promise<{ checked: boolean; status?: DeliveryStatus; event?: string; reason?: string }> {
  const [r] = await db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId));
  const key = process.env.RESEND_API_KEY;
  if (!r?.providerEmailId) return { checked: false, reason: "No email has been accepted by the provider yet" };
  if (!key) return { checked: false, reason: "RESEND_API_KEY is not set" };
  try {
    const { data, error } = await new Resend(key).emails.get(r.providerEmailId);
    if (error || !data) return { checked: false, reason: error?.message ?? "Resend returned nothing" };
    const status = deliveryFromEvent(data.last_event);
    await db.update(weeklyReports).set({ deliveryStatus: status, deliveryEvent: data.last_event, deliveryCheckedAt: new Date() }).where(eq(weeklyReports.id, reportId));
    return { checked: true, status, event: data.last_event };
  } catch (e) {
    return { checked: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Re-check every accepted brief whose delivery is not final yet (newest few only). */
export async function checkPendingDeliveries(limit = 4) {
  const rows = await db.select().from(weeklyReports).where(eq(weeklyReports.sendStatus, "accepted")).orderBy(sql`${weeklyReports.weekStart} desc`).limit(limit);
  const out: { id: number; weekStart: string; status?: DeliveryStatus; event?: string; reason?: string }[] = [];
  for (const r of rows) {
    if (isFinalDelivery(r.deliveryStatus as DeliveryStatus)) continue;
    const c = await checkDelivery(r.id);
    out.push({ id: r.id, weekStart: r.weekStart, status: c.status, event: c.event, reason: c.reason });
  }
  return out;
}

export async function latestReports(limit = 8) {
  return db.select().from(weeklyReports).orderBy(sql`${weeklyReports.weekStart} desc`).limit(limit);
}
