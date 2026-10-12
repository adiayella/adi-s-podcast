"use server";

import { refresh } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { addContact, approveDraft, deleteContact, generateDraft, rejectDraft, saveSender, updateDraft } from "@/services/outreach";

export type OutreachState = { ok: boolean; message: string } | null;

// Every action here is admin-only and none of them sends anything: they edit stored text and statuses.
const kindOf = (v: FormDataEntryValue | null) => (v === "brand" ? "brand" : "guest");

export async function generateDraftAction(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  await requireAdmin();
  try {
    const r = await generateDraft(kindOf(formData.get("kind")), Number(formData.get("id")));
    refresh();
    if (!r.ok) return { ok: false, message: r.error };
    const w = r.draft.warnings as string[];
    return { ok: true, message: w.length ? `Draft written. Check: ${w[0]}` : "Draft written. Review it before approving." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message.slice(0, 160) : "Could not write the draft" };
  }
}

export async function saveDraftAction(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  await requireAdmin();
  const r = await updateDraft(Number(formData.get("draftId")), String(formData.get("subject") ?? ""), String(formData.get("body") ?? ""));
  refresh();
  if (!r.ok) return { ok: false, message: r.error ?? "Could not save" };
  return { ok: true, message: r.warnings?.length ? `Saved. Check: ${r.warnings[0]}` : "Saved. It needs your approval again." };
}

export async function approveDraftAction(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  await requireAdmin();
  const r = await approveDraft(Number(formData.get("draftId")));
  refresh();
  return r.ok ? { ok: true, message: "Approved. Nothing has been sent; copy it and send it yourself." } : { ok: false, message: r.error ?? "Could not approve" };
}

export async function rejectDraftAction(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  await requireAdmin();
  await rejectDraft(Number(formData.get("draftId")));
  refresh();
  return { ok: true, message: "Draft rejected." };
}

export async function addContactAction(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  await requireAdmin();
  const r = await addContact({
    kind: kindOf(formData.get("kind")),
    id: Number(formData.get("id")),
    type: String(formData.get("type") ?? ""),
    value: String(formData.get("value") ?? ""),
    sourceUrl: String(formData.get("sourceUrl") ?? ""),
    note: String(formData.get("note") ?? ""),
    verified: formData.get("verified") === "on",
  });
  refresh();
  return r.ok ? { ok: true, message: "Contact saved." } : { ok: false, message: r.error };
}

export async function deleteContactAction(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  await requireAdmin();
  await deleteContact(Number(formData.get("contactId")));
  refresh();
  return { ok: true, message: "Contact removed." };
}

export async function saveSenderAction(_prev: OutreachState, formData: FormData): Promise<OutreachState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const podcast = String(formData.get("podcast") ?? "").trim();
  if (!name || !podcast) return { ok: false, message: "Enter your name and your podcast's name." };
  await saveSender(name, podcast);
  refresh();
  return { ok: true, message: "Saved. New drafts will use these." };
}
