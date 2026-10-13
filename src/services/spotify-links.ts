import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matchEpisode } from "@/discovery/spotify-trend";
import { cached } from "@/lib/api-budget";
import { isDeadEpisodeLink, spotifySearchUrl } from "@/lib/episode-link";
import { normalize } from "@/nlp/verify";
import { findShow, showEpisodes, SpotifyPaused, spotifyCalls, spotifyConfigured, type SpotifyShow } from "@/services/spotify";

// Gives every episode a link that opens: the exact Spotify episode when it can be matched, else the YouTube
// video, else a Spotify search for the exact title. Only episodes whose link is missing, dead (Spotify for
// Podcasters), a search fallback, or YouTube-in-place-of-a-dead-feed-link are looked at; good links are left alone.

const DEAD_SQL = sql`'^https?://(podcasters|creators)\\.spotify\\.com/pod/|^https?://anchor\\.fm/[^/]+/episodes/'`;

type Row = { id: number; title: string; url: string | null; publishedAt: Date; yt: string | null; show: string; showKey: number };

export type LinkRepairResult = {
  configured: boolean;
  episodes: { checked: number; spotify: number; youtube: number; search: number; unchanged: number };
  discovery: { checked: number; spotify: number; search: number; unchanged: number };
  showsMatched: number;
  showsNotFound: string[];
  spotifyCalls: number;
  applied: boolean;
  samples: { ours: string; spotify: string }[]; // matched pairs, for a human spot check
  paused?: string;
};

async function showFor(name: string): Promise<SpotifyShow | null> {
  const { value } = await cached<{ show: SpotifyShow | null }>(`spotify-show:v2:${normalize(name)}`, 24 * 30, async () => ({ show: await findShow(name) }));
  return value.show;
}

/** Group rows by show, look each show up once, and choose the best link for every row. */
async function chooseLinks(rows: Row[], result: LinkRepairResult) {
  const picks: { id: number; url: string; kind: "spotify" | "youtube" | "search" }[] = [];
  const byShow = new Map<number, Row[]>();
  for (const r of rows) byShow.set(r.showKey, [...(byShow.get(r.showKey) ?? []), r]);
  for (const group of byShow.values()) {
    let matched = 0;
    const exact = new Map<number, string>();
    const theirs = new Map<number, string>();
    if (result.configured) {
      try {
        const show = await showFor(group[0].show);
        if (show) {
          const oldest = new Date(Math.min(...group.map((r) => r.publishedAt.getTime())) - 4 * 86_400_000);
          const eps = await showEpisodes(show.id, 300, oldest);
          for (const r of group) {
            const m = matchEpisode(r, eps);
            if (m) {
              exact.set(r.id, m.url);
              theirs.set(r.id, m.title);
            }
          }
          matched = exact.size;
        }
        if (matched) result.showsMatched++;
        else result.showsNotFound.push(group[0].show);
      } catch (e) {
        // Paused by Spotify: no further calls are made this run (the client refuses them); fallbacks still apply,
        // and these episodes are looked at again on a later run.
        if (e instanceof SpotifyPaused) result.paused = e.message;
        else result.showsNotFound.push(`${group[0].show} (${e instanceof Error ? e.message : e})`);
      }
    }
    for (const r of group) {
      const url = exact.get(r.id) ?? r.yt ?? (r.url && !isDeadEpisodeLink(r.url) && !r.url.startsWith("https://open.spotify.com/search/") ? r.url : spotifySearchUrl(r.title));
      const kind = url.startsWith("https://open.spotify.com/episode/") ? "spotify" : url.includes("youtube.com/watch") ? "youtube" : url.startsWith("https://open.spotify.com/search/") ? "search" : null;
      if (url !== r.url && kind) picks.push({ id: r.id, url, kind });
      if (theirs.has(r.id) && result.samples.length < 12) result.samples.push({ ours: r.title, spotify: theirs.get(r.id)! });
    }
  }
  return picks;
}

async function write(table: "episodes" | "discovery_episodes", picks: { id: number; url: string }[]) {
  for (let i = 0; i < picks.length; i += 100) {
    const chunk = picks.slice(i, i + 100);
    await db.execute(sql`update ${sql.identifier(table)} t set url = v.url from (values ${sql.join(chunk.map((r) => sql`(${r.id}::int, ${r.url}::text)`), sql`, `)}) as v(id, url) where t.id = v.id`);
  }
}

export async function repairEpisodeLinks(opts: { apply?: boolean } = {}): Promise<LinkRepairResult> {
  const apply = opts.apply ?? true;
  const callsBefore = spotifyCalls;
  const result: LinkRepairResult = {
    configured: spotifyConfigured(),
    episodes: { checked: 0, spotify: 0, youtube: 0, search: 0, unchanged: 0 },
    discovery: { checked: 0, spotify: 0, search: 0, unchanged: 0 },
    showsMatched: 0,
    showsNotFound: [],
    spotifyCalls: 0,
    applied: apply,
    samples: [],
  };

  // Monitored episodes. A YouTube link counts as needing a look only when the feed's own link was dead.
  const eps = (
    await db.execute(sql`
      select e.id, e.title, e.url, e.published_at as "publishedAt", p.name as show, p.id as "showKey",
        (select s.url from episode_sources s where s.episode_id = e.id and s.kind = 'youtube' order by s.id limit 1) as yt
      from episodes e join podcasts p on p.id = e.podcast_id
      where e.url is null
         or e.url like 'https://open.spotify.com/search/%'
         or e.url ~ ${DEAD_SQL}
         or (e.url like 'https://www.youtube.com/watch%' and exists (select 1 from episode_sources s where s.episode_id = e.id and s.kind = 'rss' and s.url ~ ${DEAD_SQL}))`)
  ).rows as Row[];
  eps.forEach((r) => (r.publishedAt = new Date(r.publishedAt)));
  result.episodes.checked = eps.length;
  const epPicks = await chooseLinks(eps, result);
  for (const p of epPicks) result.episodes[p.kind]++;
  result.episodes.unchanged = eps.length - epPicks.length;
  if (apply) await write("episodes", epPicks);

  // Discovery episodes (shows found by research, not yet monitored).
  const disc = (
    await db.execute(sql`
      select d.id, d.title, d.url, d.published_at as "publishedAt", c.name as show, c.id as "showKey", null as yt
      from discovery_episodes d join discovery_candidates c on c.id = d.candidate_id
      where d.url like 'https://open.spotify.com/search/%' or d.url ~ ${DEAD_SQL}`)
  ).rows as Row[];
  disc.forEach((r) => (r.publishedAt = new Date(r.publishedAt)));
  result.discovery.checked = disc.length;
  const dPicks = await chooseLinks(disc, result);
  for (const p of dPicks) if (p.kind !== "youtube") result.discovery[p.kind]++;
  result.discovery.unchanged = disc.length - dPicks.length;
  if (apply) await write("discovery_episodes", dPicks);

  result.spotifyCalls = spotifyCalls - callsBefore;
  return result;
}
