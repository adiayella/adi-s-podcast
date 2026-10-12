import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ingestPodcast } from "@/services/ingest";
import { getActiveConfig } from "@/services/research-settings";

const { discoveryCandidates: cand, podcasts } = schema;

export type ReviewResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Approve: the ONLY way a discovered show enters the monitored list, and only on the founder's explicit action.
 * It is added to the watchlist and its recent episodes are collected so it has data straight away.
 */
export async function approveCandidate(id: number): Promise<ReviewResult> {
  const [c] = await db.select().from(cand).where(eq(cand.id, id));
  if (!c) return { ok: false, error: "Candidate not found" };
  if (c.status === "approved") return { ok: false, error: "Already approved" };
  if (!c.rssUrl) return { ok: false, error: "This show has no RSS feed we can collect from yet. Add its feed URL in Manage Podcasts first." };

  const [inserted] = await db
    .insert(podcasts)
    .values({ name: c.name, rssUrl: c.rssUrl, youtubeChannelId: c.youtubeChannelId, enabled: true })
    .onConflictDoNothing({ target: podcasts.rssUrl })
    .returning();
  const podcast = inserted ?? (await db.select().from(podcasts).where(eq(podcasts.rssUrl, c.rssUrl)))[0];
  if (!podcast) return { ok: false, error: "Could not add the podcast" };

  const { config } = await getActiveConfig();
  const res = await ingestPodcast(podcast, Math.min(config.dateRangeDays, 90)); // initial backfill
  await db.update(cand).set({ status: "approved", promotedPodcastId: podcast.id, decidedAt: new Date() }).where(eq(cand.id, id));
  return { ok: true, message: res.error ? `Added ${c.name} to your watchlist, but the first sync failed: ${res.error}` : `Added ${c.name} to your watchlist and collected ${res.inserted} episodes.` };
}

export type DecisionStatus = "dismissed" | "saved" | "excluded" | "new";

/** Dismiss, save for later, exclude from future suggestions, or move back into the review queue. */
export async function setCandidateStatus(id: number, status: DecisionStatus, note?: string): Promise<ReviewResult> {
  const [c] = await db.select().from(cand).where(eq(cand.id, id));
  if (!c) return { ok: false, error: "Candidate not found" };
  if (c.status === "approved") return { ok: false, error: "This show is already on your watchlist. Remove it in Manage Podcasts." };
  await db.update(cand).set({ status, decidedAt: status === "new" ? null : new Date(), decisionNote: note ?? null }).where(eq(cand.id, id));
  const verb = { dismissed: "Dismissed", saved: "Saved for later", excluded: "Excluded from future suggestions", new: "Moved back to the review queue" }[status];
  return { ok: true, message: `${verb}: ${c.name}` };
}
