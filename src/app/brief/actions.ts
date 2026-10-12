"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { generateBrief, sendBrief } from "@/services/brief";

export type BriefActionState = { ok: boolean; message: string } | null;

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
