import Parser from "rss-parser";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { descriptionKey, durationToSeconds, isReupload, type KnownEpisode } from "@/services/episode-dedupe";
import { permissionFor } from "@/transcripts/policy";
import { pickTranscriptLink, type TranscriptLink } from "@/transcripts/parse";
import { listenUrl } from "@/lib/episode-link";

const { podcasts, episodes, episodeSources, episodeTranscripts } = schema;

const parser = new Parser({
  timeout: 30_000,
  headers: { "User-Agent": "Mozilla/5.0 (compatible; PodcastRadar/1.0)" },
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      // Podcasting 2.0: links to a creator-published transcript, one element per format
      ["podcast:transcript", "transcripts", { keepArray: true }],
    ],
  },
});

const MAX_DESCRIPTION_CHARS = 20_000;

export type IngestResult = {
  podcastId: number;
  name: string;
  seen: number;
  inserted: number;
  duplicatesSkipped?: number; // re-uploads caught by their description
  transcriptLinks?: number; // published transcripts discovered in the feed
  error?: string;
};

export function htmlToText(html: string): string {
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

    // episodes we already hold, so a re-titled re-upload of one of them is recognised and skipped
    const existing = await db
      .select({ dedupeKey: episodes.dedupeKey, description: episodes.description, publishedAt: episodes.publishedAt })
      .from(episodes)
      .where(and(eq(episodes.podcastId, podcast.id), gte(episodes.publishedAt, new Date(Date.now() - 200 * 86_400_000))));
    const known: KnownEpisode[] = existing.map((e) => ({ dedupeKey: e.dedupeKey, descKey: descriptionKey(e.description), publishedAt: e.publishedAt }));
    let duplicatesSkipped = 0;

    const rows = new Map<string, typeof episodes.$inferInsert & { guid: string; link: TranscriptLink | null }>();
    for (const item of feed.items) {
      const title = item.title?.trim();
      const published = item.isoDate ? new Date(item.isoDate) : null;
      if (!title || !published || Number.isNaN(published.getTime())) continue;
      if (published.getTime() < cutoff) continue;

      const raw =
        (item as { contentEncoded?: string }).contentEncoded || item.content || item.contentSnippet || "";
      const key = dedupeKey(title);
      if (!key || rows.has(key)) continue;
      const description = htmlToText(raw).slice(0, MAX_DESCRIPTION_CHARS);
      const candidate: KnownEpisode = { dedupeKey: key, descKey: descriptionKey(description), publishedAt: published };
      if (isReupload(candidate, known)) {
        duplicatesSkipped++;
        continue;
      }
      known.push(candidate);

      const links = ((item as { transcripts?: { $?: { url?: string; type?: string } }[] }).transcripts ?? [])
        .map((t) => ({ url: t.$?.url ?? "", type: t.$?.type ?? "" }))
        .filter((t) => t.url && t.type);
      rows.set(key, {
        podcastId: podcast.id,
        title,
        description,
        publishedAt: published,
        url: item.link ?? null,
        dedupeKey: key,
        durationSeconds: durationToSeconds((item as { itunes?: { duration?: string } }).itunes?.duration),
        guid: item.guid || item.link || key,
        link: pickTranscriptLink(links),
      });
    }
    result.seen = rows.size;
    result.duplicatesSkipped = duplicatesSkipped;

    if (rows.size) {
      const values = [...rows.values()].map((r) => ({ podcastId: r.podcastId, title: r.title, description: r.description, publishedAt: r.publishedAt, url: listenUrl(r.url, r.title), dedupeKey: r.dedupeKey, durationSeconds: r.durationSeconds ?? null }));
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

      // fill in audio lengths we did not know before (used to tell a full episode from a clip)
      const durations = [...rows.entries()].flatMap(([key, r]) => (r.durationSeconds && idByKey.get(key) ? [{ id: idByKey.get(key)!, sec: r.durationSeconds }] : []));
      for (let i = 0; i < durations.length; i += 100) {
        const chunk = durations.slice(i, i + 100);
        await db.execute(sql`update episodes set duration_seconds = v.sec from (values ${sql.join(chunk.map((d) => sql`(${d.id}::int, ${d.sec}::int)`), sql`, `)}) as v(id, sec) where episodes.id = v.id and episodes.duration_seconds is null`);
      }

      // Record published transcripts. Whether we may use them is decided by the rights gate, not here.
      const perm = permissionFor("rss_tag", podcast);
      const links = [...rows.entries()].flatMap(([key, r]) => {
        const episodeId = idByKey.get(key);
        if (!episodeId || !r.link) return [];
        return [
          {
            episodeId,
            source: "rss_tag",
            sourceUrl: r.link.url,
            format: r.link.type,
            rightsBasis: perm.allowed ? perm.basis : "Not permitted for this show",
            status: perm.allowed ? "available" : "not_permitted",
            error: perm.allowed ? null : perm.reason,
          },
        ];
      });
      for (let i = 0; i < links.length; i += 100) await db.insert(episodeTranscripts).values(links.slice(i, i + 100)).onConflictDoNothing();
      result.transcriptLinks = links.length;
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

export async function ingestAllEnabled(sinceDays: number, priorityIds: number[] = []): Promise<IngestResult[]> {
  const found = await db.select().from(podcasts).where(eq(podcasts.enabled, true));
  // the founder's priority shows are collected first, so they are never the ones cut off by a time limit
  const list = [...found].sort((a, b) => Number(priorityIds.includes(b.id)) - Number(priorityIds.includes(a.id)));
  const results: IngestResult[] = [];
  for (const p of list) results.push(await ingestPodcast(p, sinceDays));
  return results;
}
