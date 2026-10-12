import Parser from "rss-parser";
import { cached } from "@/lib/api-budget";
import { normalize } from "@/nlp/verify";
import { dedupeKey, htmlToText } from "@/services/ingest";
import { fetchRecentVideos, titleSimilarity, yt } from "@/services/youtube";
import type { CandidateEpisode } from "./evaluate";

// External lookups for discovery. All of them are cached, retry at most twice, and return only real data.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string): Promise<T> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "PodcastRadar/1.0" } });
    if (res.ok) return res.json() as Promise<T>;
    lastStatus = res.status;
    if (res.status !== 429 && res.status < 500) break;
    await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`HTTP ${lastStatus} from ${new URL(url).host}`);
}

// ---------------------------------------------------------------- Apple Podcasts directory (free, no key)
export type AppleHit = { appleId: string; name: string; publisher: string | null; feedUrl: string | null; genre: string | null; country: string; trackCount: number; latestAt: string | null };

export async function appleSearch(term: string, country: string): Promise<{ hits: AppleHit[]; cacheHit: boolean }> {
  const key = `apple:${country}:${normalize(term)}`;
  const { value, hit } = await cached<AppleHit[]>(key, 24 * 7, async () => {
    await sleep(350); // the directory allows roughly 20 requests a minute
    const r = await getJson<{ results: Record<string, unknown>[] }>(
      `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&country=${country}&term=${encodeURIComponent(term)}`,
    );
    return r.results.map((x) => ({
      appleId: String(x.collectionId),
      name: String(x.collectionName ?? ""),
      publisher: (x.artistName as string) ?? null,
      feedUrl: (x.feedUrl as string) ?? null,
      genre: (x.primaryGenreName as string) ?? null,
      country,
      trackCount: Number(x.trackCount ?? 0),
      latestAt: (x.releaseDate as string) ?? null,
    }));
  });
  return { hits: value, cacheHit: hit };
}

/** Find a show's RSS feed by name through the same free directory (used for YouTube-only discoveries). */
export async function findFeedByName(name: string, country = "IN"): Promise<string | null> {
  const { hits } = await appleSearch(name, country);
  const best = hits.map((h) => ({ h, s: titleSimilarity(name, h.name) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= 0.8 && best.h.feedUrl ? best.h.feedUrl : null;
}

// ---------------------------------------------------------------- RSS feeds
const parser = new Parser({ timeout: 20_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; PodcastRadar/1.0)" }, customFields: { item: [["content:encoded", "contentEncoded"]] } });

export type FeedData = { title: string | null; language: string | null; episodes: (CandidateEpisode & { dedupeKey: string })[] };

export async function fetchFeed(rssUrl: string, days = 90): Promise<FeedData> {
  const feed = await parser.parseURL(rssUrl).catch(() => parser.parseURL(rssUrl)); // one retry
  const cutoff = Date.now() - days * 86_400_000;
  const seen = new Set<string>();
  const episodes: FeedData["episodes"] = [];
  for (const item of feed.items) {
    const title = item.title?.trim();
    const at = item.isoDate ? new Date(item.isoDate) : null;
    if (!title || !at || Number.isNaN(at.getTime()) || at.getTime() < cutoff) continue;
    const key = dedupeKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const raw = (item as { contentEncoded?: string }).contentEncoded || item.content || item.contentSnippet || "";
    episodes.push({ title, description: htmlToText(raw).slice(0, 8000), publishedAt: at, url: item.link ?? null, dedupeKey: key });
  }
  const language = (feed as { language?: string }).language?.toLowerCase().split("-")[0] ?? null;
  return { title: feed.title ?? null, language, episodes };
}

export function languageAllowed(feedLanguage: string | null, wanted: string[]): boolean {
  return wanted.length === 0 || !feedLanguage || wanted.includes(feedLanguage);
}

// ---------------------------------------------------------------- YouTube (budgeted by the caller's meter)
export type ChannelHit = { channelId: string; title: string; subscribers: number | null; videoCount: number | null };

async function channelDetails(ids: string[]): Promise<ChannelHit[]> {
  if (!ids.length) return [];
  const r = await yt<{ items: { id: string; snippet: { title: string }; statistics?: { subscriberCount?: string; videoCount?: string } }[] }>("channels", { part: "snippet,statistics", id: ids.join(",") });
  return r.items.map((c) => ({ channelId: c.id, title: c.snippet.title, subscribers: c.statistics?.subscriberCount ? Number(c.statistics.subscriberCount) : null, videoCount: c.statistics?.videoCount ? Number(c.statistics.videoCount) : null }));
}

/** Keyword search for YouTube channels. Costs 100 units; the result is cached for two weeks. */
export async function youtubeChannelSearch(term: string, region?: string): Promise<{ hits: ChannelHit[]; cacheHit: boolean }> {
  const key = `yt-search:${region ?? "any"}:${normalize(term)}`;
  const { value, hit } = await cached<ChannelHit[]>(key, 24 * 14, async () => {
    const s = await yt<{ items: { id: { channelId: string } }[] }>("search", { part: "snippet", type: "channel", maxResults: "8", q: term, ...(region ? { regionCode: region } : {}) });
    return channelDetails(s.items.map((i) => i.id.channelId));
  });
  return { hits: value, cacheHit: hit };
}

/** Map a podcast name to its YouTube channel. Accepts only a close title match, never a guess. */
export async function mapToChannel(name: string): Promise<ChannelHit | null> {
  const { hits } = await youtubeChannelSearch(name);
  const best = hits.map((h) => ({ h, s: titleSimilarity(name, h.title) })).filter((x) => x.s >= 0.75).sort((a, b) => b.s - a.s)[0];
  return best?.h ?? null;
}

/** Long videos from a channel as episodes, with real view counts. About 3 units for 90 days. */
export async function youtubeEpisodes(channelId: string, days = 90): Promise<(CandidateEpisode & { dedupeKey: string })[]> {
  const videos = await fetchRecentVideos(channelId, days);
  return videos
    .filter((v) => v.seconds >= 15 * 60)
    .map((v) => ({ title: v.title, description: v.description.slice(0, 8000), publishedAt: v.publishedAt, url: `https://www.youtube.com/watch?v=${v.id}`, views: v.views, dedupeKey: dedupeKey(v.title) }));
}
