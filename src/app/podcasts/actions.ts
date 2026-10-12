"use server";

import { eq } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAdmin, isAdmin } from "@/lib/admin";
import { isPublicHttpUrl } from "@/lib/url-safety";
import { ingestPodcast } from "@/services/ingest";
import { applyTranscriptPolicy } from "@/transcripts/apply-policy";

const { podcasts } = schema;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const podcastInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  rssUrl: z.preprocess(emptyToUndefined, z.string().trim().max(600).refine(isPublicHttpUrl, "RSS URL must be a public http(s) address").optional()),
  youtubeChannelId: z.preprocess(
    emptyToUndefined,
    z.string().trim().regex(/^UC[\w-]{22}$/, "YouTube channel IDs look like UCxxxxxxxxxxxxxxxxxxxxxx").optional(),
  ),
});

export type ActionState = { ok: boolean; message: string } | null;

function parse(formData: FormData) {
  return podcastInput.safeParse({
    name: formData.get("name"),
    rssUrl: formData.get("rssUrl"),
    youtubeChannelId: formData.get("youtubeChannelId"),
  });
}

export async function addPodcast(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await isAdmin())) return { ok: false, message: "Admin login required" };
  const parsed = parse(formData);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { name, rssUrl, youtubeChannelId } = parsed.data;
  if (!rssUrl && !youtubeChannelId) return { ok: false, message: "Provide an RSS URL or a YouTube channel ID" };

  const [row] = await db
    .insert(podcasts)
    .values({ name, rssUrl: rssUrl ?? null, youtubeChannelId: youtubeChannelId ?? null, enabled: true })
    .onConflictDoNothing({ target: podcasts.rssUrl })
    .returning();
  if (!row) return { ok: false, message: "A podcast with that RSS URL already exists" };

  const res = await ingestPodcast(row, 90); // backfill so the new show has data straight away
  revalidatePath("/", "layout");
  refresh();
  return {
    ok: !res.error,
    message: res.error ? `Added, but the first sync failed: ${res.error}` : `Added ${name} and collected ${res.inserted} episodes`,
  };
}

export async function updatePodcast(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("id"));
  const parsed = parse(formData);
  if (!Number.isInteger(id) || !parsed.success) return;
  const { name, rssUrl, youtubeChannelId } = parsed.data;
  const allowPublic = formData.get("allowPublicTranscripts") === "on";
  const [prev] = await db.select({ allow: podcasts.allowPublicTranscripts }).from(podcasts).where(eq(podcasts.id, id));
  await db
    .update(podcasts)
    .set({
      name,
      rssUrl: rssUrl ?? null,
      youtubeChannelId: youtubeChannelId ?? null,
      allowPublicTranscripts: allowPublic,
      audioTranscriptionRights: formData.get("audioTranscriptionRights") === "authorized" ? "authorized" : "none",
    })
    .where(eq(podcasts.id, id));
  // switching published transcripts on or off takes effect on coverage and analysis straight away
  if (prev && prev.allow !== allowPublic) await applyTranscriptPolicy(id, allowPublic);
  revalidatePath("/", "layout");
  refresh();
}

export async function setEnabled(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await db.update(podcasts).set({ enabled: formData.get("enabled") === "true" }).where(eq(podcasts.id, id));
  revalidatePath("/", "layout");
  refresh();
}

export async function deletePodcast(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await db.delete(podcasts).where(eq(podcasts.id, id)); // episodes cascade
  revalidatePath("/", "layout");
  refresh();
}

export async function syncPodcast(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  const [p] = await db.select().from(podcasts).where(eq(podcasts.id, id));
  if (p) await ingestPodcast(p, 30);
  revalidatePath("/", "layout");
  refresh();
  redirect("/podcasts");
}
