import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalize } from "@/nlp/verify";

const { podcasts, episodes, episodeSources } = schema;
const API = "https://www.googleapis.com/youtube/v3";
const MIN_EPISODE_SECONDS = 15 * 60; // shorter videos are clips/shorts, not full episodes
const STOPWORDS = new Set(["the", "a", "an", "of", "and", "to", "in", "on", "for", "with", "is", "are", "how", "why", "what", "ft", "feat", "ep", "episode", "trs"]);

type Video = {
  id: string;
  title: string;
  description: string;
  publishedAt: Date;
  seconds: number;
  paid: boolean;
};

async function yt<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set");
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${path} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json() as Promise<T>;
}

function isoDurationToSeconds(d: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/** Recent uploads via the channel's uploads playlist (1 quota unit per 50 videos, vs 100 for search). */
export async function fetchRecentVideos(channelId: string, sinceDays: number): Promise<Video[]> {
  const playlistId = "UU" + channelId.slice(2);
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await yt<{
      items: { contentDetails: { videoId: string; videoPublishedAt?: string } }[];
      nextPageToken?: string;
    }>("playlistItems", { part: "contentDetails", playlistId, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    let reachedOld = false;
    for (const it of r.items) {
      const t = it.contentDetails.videoPublishedAt ? new Date(it.contentDetails.videoPublishedAt).getTime() : Date.now();
      if (t < cutoff) reachedOld = true;
      else ids.push(it.contentDetails.videoId);
    }
    pageToken = r.nextPageToken;
    if (reachedOld || !pageToken) break;
  }

  const videos: Video[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const r = await yt<{
      items: {
        id: string;
        snippet: { title: string; description: string; publishedAt: string };
        contentDetails: { duration: string };
        paidProductPlacementDetails?: { hasPaidProductPlacement?: boolean };
      }[];
    }>("videos", { part: "snippet,contentDetails,paidProductPlacementDetails", id: batch.join(","), maxResults: "50" });
    for (const v of r.items) {
      videos.push({
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        publishedAt: new Date(v.snippet.publishedAt),
        seconds: isoDurationToSeconds(v.contentDetails.duration),
        paid: v.paidProductPlacementDetails?.hasPaidProductPlacement === true,
      });
    }
  }
  return videos;
}

function tokens(title: string): Set<string> {
  return new Set(normalize(title).split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t)));
}

export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size); // overlap coefficient: robust when one title is shorter
}

export type YoutubeSyncResult = {
  podcastId: number;
  name: string;
  longVideos: number;
  matched: number;
  paidFlagged: number;
  unmatched: string[];
  error?: string;
};

type EpisodeRow = { id: number; title: string; publishedAt: Date };

/** Attach YouTube data to episodes we already have from RSS. Never creates episodes. */
export async function syncYoutube(podcast: typeof podcasts.$inferSelect, sinceDays: number): Promise<YoutubeSyncResult> {
  const result: YoutubeSyncResult = { podcastId: podcast.id, name: podcast.name, longVideos: 0, matched: 0, paidFlagged: 0, unmatched: [] };
  try {
    if (!podcast.youtubeChannelId) throw new Error("No YouTube channel configured");
    const videos = (await fetchRecentVideos(podcast.youtubeChannelId, sinceDays)).filter((v) => v.seconds >= MIN_EPISODE_SECONDS);
    result.longVideos = videos.length;

    for (const v of videos) {
      const lo = new Date(v.publishedAt.getTime() - 14 * 86_400_000);
      const hi = new Date(v.publishedAt.getTime() + 14 * 86_400_000);
      const candidates: EpisodeRow[] = await db
        .select({ id: episodes.id, title: episodes.title, publishedAt: episodes.publishedAt })
        .from(episodes)
        .where(and(eq(episodes.podcastId, podcast.id), gte(episodes.publishedAt, lo), lte(episodes.publishedAt, hi)));
      const days = (c: EpisodeRow) => Math.abs(c.publishedAt.getTime() - v.publishedAt.getTime()) / 86_400_000;
      const scored = candidates.map((c) => ({ c, s: titleSimilarity(v.title, c.title), d: days(c) })).sort((a, b) => b.s - a.s);
      const best = scored[0];
      const near = candidates.filter((c) => days(c) <= 3).length;
      // Within 3 days: a decent title match, or a weak one if it is the only episode nearby.
      // Up to 14 days apart (video and RSS often publish on different days): only a very strong match.
      const ok = best && ((best.d <= 3 && (best.s >= 0.5 || (near === 1 && best.s >= 0.2))) || best.s >= 0.75);
      if (!ok) {
        result.unmatched.push(v.title.slice(0, 70));
        continue;
      }
      await db
        .insert(episodeSources)
        .values({
          episodeId: best.c.id,
          kind: "youtube",
          externalId: v.id,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          title: v.title,
          description: v.description,
          publishedAt: v.publishedAt,
          paidPromotion: v.paid,
        })
        .onConflictDoUpdate({
          target: [episodeSources.kind, episodeSources.externalId],
          set: { title: v.title, description: v.description, paidPromotion: v.paid },
        });
      result.matched++;
      if (v.paid) result.paidFlagged++;
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}
