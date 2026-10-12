"use server";

import { eq } from "drizzle-orm";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { ingestPodcast } from "@/services/ingest";

const { podcasts } = schema;

// The server fetches whatever feed URL is stored, so refuse non-web and internal addresses.
function isPublicHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}

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
  const id = Number(formData.get("id"));
  const parsed = parse(formData);
  if (!Number.isInteger(id) || !parsed.success) return;
  const { name, rssUrl, youtubeChannelId } = parsed.data;
  await db
    .update(podcasts)
    .set({ name, rssUrl: rssUrl ?? null, youtubeChannelId: youtubeChannelId ?? null })
    .where(eq(podcasts.id, id));
  revalidatePath("/", "layout");
  refresh();
}

export async function setEnabled(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await db.update(podcasts).set({ enabled: formData.get("enabled") === "true" }).where(eq(podcasts.id, id));
  revalidatePath("/", "layout");
  refresh();
}

export async function deletePodcast(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  await db.delete(podcasts).where(eq(podcasts.id, id)); // episodes cascade
  revalidatePath("/", "layout");
  refresh();
}

export async function syncPodcast(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  const [p] = await db.select().from(podcasts).where(eq(podcasts.id, id));
  if (p) await ingestPodcast(p, 30);
  revalidatePath("/", "layout");
  refresh();
  redirect("/podcasts");
}
