import Parser from "rss-parser";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

const { podcasts, episodes, episodeSources } = schema;

const parser = new Parser({
  timeout: 30_000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; PodcastRadar/1.0)" },
  customFields: { item: [["content:encoded", "contentEncoded"]] },
});

const MAX_DESCRIPTION_CHARS = 20_000;

export type IngestResult = {
  podcastId: number;
  name: string;
  seen: number;
  inserted: number;
  error?: string;
};

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Same show + same normalized title = same episode, whichever platform it came from.
export function dedupeKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Pull one podcast's RSS feed and store episodes published within `sinceDays`.
 * Idempotent: unique keys on (podcast, dedupe key) and (source kind, external id)
 * mean re-running never creates duplicates.
 */
export async function ingestPodcast(
  podcast: typeof podcasts.$inferSelect,
  sinceDays: number,
): Promise<IngestResult> {
  const result: IngestResult = { podcastId: podcast.id, name: podcast.name, seen: 0, inserted: 0 };
  try {
    if (!podcast.rssUrl) throw new Error("No RSS URL configured");
    // One retry: a single slow or flaky feed should not cost a whole day of data.
    const feed = await parser.parseURL(podcast.rssUrl).catch(() => parser.parseURL(podcast.rssUrl!));
    const cutoff = Date.now() - sinceDays * 86_400_000;

    const rows = new Map<string, typeof episodes.$inferInsert & { guid: string }>();
    for (const item of feed.items) {
      const title = item.title?.trim();
      const published = item.isoDate ? new Date(item.isoDate) : null;
      if (!title || !published || Number.isNaN(published.getTime())) continue;
      if (published.getTime() < cutoff) continue;

      const raw =
        (item as { contentEncoded?: string }).contentEncoded || item.content || item.contentSnippet || "";
      const key = dedupeKey(title);
      if (!key || rows.has(key)) continue;
      rows.set(key, {
        podcastId: podcast.id,
        title,
        description: htmlToText(raw).slice(0, MAX_DESCRIPTION_CHARS),
        publishedAt: published,
        url: item.link ?? null,
        dedupeKey: key,
        guid: item.guid || item.link || key,
      });
    }
    result.seen = rows.size;

    if (rows.size) {
      const values = [...rows.values()].map((r) => ({ podcastId: r.podcastId, title: r.title, description: r.description, publishedAt: r.publishedAt, url: r.url, dedupeKey: r.dedupeKey }));
      const inserted = await db
        .insert(episodes)
        .values(values)
        .onConflictDoNothing({ target: [episodes.podcastId, episodes.dedupeKey] })
        .returning({ id: episodes.id });
      result.inserted = inserted.length;

      const stored = await db
        .select({ id: episodes.id, dedupeKey: episodes.dedupeKey })
        .from(episodes)
        .where(and(eq(episodes.podcastId, podcast.id), inArray(episodes.dedupeKey, [...rows.keys()])));
      const idByKey = new Map(stored.map((e) => [e.dedupeKey, e.id]));

      const sources = [...rows.entries()].flatMap(([key, r]) => {
        const episodeId = idByKey.get(key);
        return episodeId
          ? [{ episodeId, kind: "rss" as const, externalId: `${podcast.id}:${r.guid}`, url: r.url }]
          : [];
      });
      if (sources.length) {
        await db.insert(episodeSources).values(sources).onConflictDoNothing();
      }
    }

    await db
      .update(podcasts)
      .set({ lastSyncAt: new Date(), lastSyncStatus: "ok", lastSyncError: null })
      .where(eq(podcasts.id, podcast.id));
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    await db
      .update(podcasts)
      .set({ lastSyncAt: new Date(), lastSyncStatus: "error", lastSyncError: result.error.slice(0, 500) })
      .where(eq(podcasts.id, podcast.id));
  }
  return result;
}

export async function ingestAllEnabled(sinceDays: number): Promise<IngestResult[]> {
  const list = await db.select().from(podcasts).where(eq(podcasts.enabled, true));
  const results: IngestResult[] = [];
  for (const p of list) results.push(await ingestPodcast(p, sinceDays));
  return results;
}
