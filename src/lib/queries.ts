import { sql } from "drizzle-orm";
import { db } from "@/db";

// All dashboard numbers come from SQL, never from an AI model.
// "Monitored" = podcasts with enabled = true. Weeks start Monday, in IST.

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

export type RangeDays = 7 | 30 | 90;
export function parseRange(v: string | string[] | undefined): RangeDays {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return n === 7 || n === 90 ? n : 30;
}

export type Kpis = {
  podcastsEnabled: number;
  podcastsTotal: number;
  syncErrors: number;
  lastSyncAt: string | null;
  episodesInRange: number;
  episodesPrevRange: number;
  episodesLast7: number;
  episodesPrev7: number;
  episodesAll: number;
  guests: number;
  topics: number;
  brands: number;
};

export async function getKpis(range: RangeDays): Promise<Kpis> {
  const [r] = await rows<Record<string, string | number | null>>(sql`
    select
      (select count(*) from podcasts where enabled) as "podcastsEnabled",
      (select count(*) from podcasts) as "podcastsTotal",
      (select count(*) from podcasts where enabled and last_sync_status = 'error') as "syncErrors",
      (select max(last_sync_at) from podcasts where enabled) as "lastSyncAt",
      count(*) filter (where e.published_at >= now() - make_interval(days => ${range}::int)) as "episodesInRange",
      count(*) filter (where e.published_at >= now() - make_interval(days => ${range * 2}::int)
                         and e.published_at <  now() - make_interval(days => ${range}::int)) as "episodesPrevRange",
      count(*) filter (where e.published_at >= now() - interval '7 days') as "episodesLast7",
      count(*) filter (where e.published_at >= now() - interval '14 days'
                         and e.published_at <  now() - interval '7 days') as "episodesPrev7",
      count(*) as "episodesAll",
      (select count(*) from guests) as guests,
      (select count(*) from topics) as topics,
      (select count(*) from brands) as brands
    from episodes e join podcasts p on p.id = e.podcast_id and p.enabled
  `);
  const n = (k: string) => Number(r?.[k] ?? 0);
  return {
    podcastsEnabled: n("podcastsEnabled"),
    podcastsTotal: n("podcastsTotal"),
    syncErrors: n("syncErrors"),
    lastSyncAt: (r?.lastSyncAt as string | null) ?? null,
    episodesInRange: n("episodesInRange"),
    episodesPrevRange: n("episodesPrevRange"),
    episodesLast7: n("episodesLast7"),
    episodesPrev7: n("episodesPrev7"),
    episodesAll: n("episodesAll"),
    guests: n("guests"),
    topics: n("topics"),
    brands: n("brands"),
  };
}

export type WeekPoint = { week: string; label: string; episodes: number };

export async function getWeeklySeries(weeks = 12): Promise<WeekPoint[]> {
  const res = await rows<{ week: string; label: string; episodes: number }>(sql`
    with w as (
      select generate_series(
        date_trunc('week', (now() at time zone 'Asia/Kolkata')) - make_interval(weeks => ${weeks - 1}::int),
        date_trunc('week', (now() at time zone 'Asia/Kolkata')),
        interval '1 week') as wk
    )
    select to_char(w.wk, 'YYYY-MM-DD') as week,
           to_char(w.wk, 'DD Mon') as label,
           count(e.id)::int as episodes
    from w
    left join (
      select e.id, e.published_at at time zone 'Asia/Kolkata' as pub
      from episodes e join podcasts p on p.id = e.podcast_id and p.enabled
    ) e on date_trunc('week', e.pub) = w.wk
    group by w.wk order by w.wk
  `);
  return res.map((r) => ({ ...r, episodes: Number(r.episodes) }));
}

export type ShowActivity = { id: number; name: string; episodes: number; lastPublished: string | null };

export async function getShowActivity(range: RangeDays): Promise<ShowActivity[]> {
  const res = await rows<ShowActivity>(sql`
    select p.id, p.name,
           count(e.id) filter (where e.published_at >= now() - make_interval(days => ${range}::int))::int as episodes,
           max(e.published_at) as "lastPublished"
    from podcasts p left join episodes e on e.podcast_id = p.id
    where p.enabled
    group by p.id, p.name
    order by episodes desc, p.name
  `);
  return res.map((r) => ({ ...r, episodes: Number(r.episodes) }));
}

// 6 four-hour buckets (IST) x 7 weekdays (Mon..Sun), last 90 days
export async function getPublishingHeatmap(): Promise<number[][]> {
  const res = await rows<{ dow: number; bucket: number; n: number }>(sql`
    select (extract(isodow from t.pub)::int - 1) as dow,
           (extract(hour from t.pub)::int / 4) as bucket,
           count(*)::int as n
    from (
      select e.published_at at time zone 'Asia/Kolkata' as pub
      from episodes e join podcasts p on p.id = e.podcast_id and p.enabled
      where e.published_at >= now() - interval '90 days'
    ) t group by 1, 2
  `);
  const grid = Array.from({ length: 6 }, () => Array<number>(7).fill(0));
  for (const r of res) grid[Number(r.bucket)][Number(r.dow)] = Number(r.n);
  return grid;
}

export type LatestEpisode = {
  id: number;
  title: string;
  url: string | null;
  publishedAt: string;
  podcast: string;
};

export async function getLatestEpisodes(limit = 10): Promise<LatestEpisode[]> {
  return rows<LatestEpisode>(sql`
    select e.id, e.title, e.url, e.published_at as "publishedAt", p.name as podcast
    from episodes e join podcasts p on p.id = e.podcast_id and p.enabled
    order by e.published_at desc limit ${limit}
  `);
}

export type PodcastRow = {
  id: number;
  name: string;
  rssUrl: string | null;
  youtubeChannelId: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  episodes: number;
  latestEpisode: string | null;
  transcriptEpisodes: number; // episodes analysed from a transcript rather than title and description only
  allowPublicTranscripts: boolean;
  audioTranscriptionRights: string; // 'none' | 'authorized' (a recorded permission; no audio is processed by this app yet)
};

export async function getPodcastRows(): Promise<PodcastRow[]> {
  const res = await rows<PodcastRow>(sql`
    select p.id, p.name, p.rss_url as "rssUrl", p.youtube_channel_id as "youtubeChannelId",
           p.enabled, p.last_sync_at as "lastSyncAt", p.last_sync_status as "lastSyncStatus",
           p.last_sync_error as "lastSyncError",
           count(e.id)::int as episodes, max(e.published_at) as "latestEpisode",
           count(e.id) filter (where e.coverage = 'transcript')::int as "transcriptEpisodes",
           p.allow_public_transcripts as "allowPublicTranscripts", p.audio_transcription_rights as "audioTranscriptionRights"
    from podcasts p left join episodes e on e.podcast_id = p.id
    group by p.id order by p.enabled desc, p.name
  `);
  return res.map((r) => ({ ...r, episodes: Number(r.episodes), transcriptEpisodes: Number(r.transcriptEpisodes) }));
}

/** How deep the analysis goes: episodes analysed from a transcript versus from title and description only. */
export async function getCoverage(): Promise<{ total: number; transcript: number; shows: number }> {
  const [r] = await rows<{ total: number; transcript: number; shows: number }>(sql`
    select count(*)::int as total, count(*) filter (where e.coverage = 'transcript')::int as transcript,
           count(distinct e.podcast_id) filter (where e.coverage = 'transcript')::int as shows
    from episodes e join podcasts p on p.id = e.podcast_id and p.enabled`);
  return { total: Number(r?.total ?? 0), transcript: Number(r?.transcript ?? 0), shows: Number(r?.shows ?? 0) };
}

export async function getTranscriptStatus() {
  return rows<{ source: string; status: string; n: number }>(sql`select source, status, count(*)::int as n from episode_transcripts group by 1, 2 order by 1, 2`);
}

export type WeeklyReportRow = { id: number; weekStart: string; briefMarkdown: string; emailStatus: string; createdAt: string };

export async function getWeeklyReports(): Promise<WeeklyReportRow[]> {
  return rows<WeeklyReportRow>(sql`
    select id, week_start::text as "weekStart", brief_markdown as "briefMarkdown",
           email_status as "emailStatus", created_at as "createdAt"
    from weekly_reports order by week_start desc limit 12
  `);
}
