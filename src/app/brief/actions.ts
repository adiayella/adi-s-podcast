"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { z } from "zod";
import { db, schema } from "@/db";
import { checkDelivery, generateBrief, latestReports, sendBrief } from "@/services/brief";

export type BriefActionState = { ok: boolean; message: string } | null;

// useActionState passes the previous state as the first argument; it is not needed here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function generateNow(_prev: BriefActionState): Promise<BriefActionState> {
  await requireAdmin();
  try {
    const r = await generateBrief({ force: true });
    refresh();
    return { ok: true, message: r.narrativeError ? `Generated without AI commentary: ${r.narrativeError}` : "Brief generated from the latest data." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Generation failed" };
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function sendNow(_prev: BriefActionState): Promise<BriefActionState> {
  await requireAdmin();
  try {
    const r = await sendBrief({ force: true });
    refresh();
    return r.sent ? { ok: true, message: `Sent to ${r.to}.` } : { ok: false, message: r.reason ?? "Not sent" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Send failed" };
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function checkDeliveryNow(_prev: BriefActionState): Promise<BriefActionState> {
  await requireAdmin();
  const [latest] = await latestReports(1);
  if (!latest) return { ok: false, message: "There is no brief yet" };
  const r = await checkDelivery(latest.id);
  refresh();
  if (!r.checked) return { ok: false, message: r.reason ?? "Could not check" };
  return { ok: true, message: `Provider says: ${r.event} (${r.status})` };
}

const deliverySchema = z.object({
  recipient: z.string().trim().email("Enter a valid email address").max(200),
  hourIST: z.coerce.number().int().min(0).max(23),
});

export async function saveDelivery(_prev: BriefActionState, formData: FormData): Promise<BriefActionState> {
  await requireAdmin();
  const parsed = deliverySchema.safeParse({ recipient: formData.get("recipient"), hourIST: formData.get("hourIST") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  const now = new Date();
  await db.insert(schema.settings).values({ key: "briefRecipient", value: parsed.data.recipient, updatedAt: now }).onConflictDoUpdate({ target: schema.settings.key, set: { value: parsed.data.recipient, updatedAt: now } });
  await db.insert(schema.settings).values({ key: "briefHourIST", value: parsed.data.hourIST, updatedAt: now }).onConflictDoUpdate({ target: schema.settings.key, set: { value: parsed.data.hourIST, updatedAt: now } });
  refresh();
  return { ok: true, message: "Delivery settings saved." };
}
