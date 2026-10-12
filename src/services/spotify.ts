import { bestShowByName } from "@/discovery/spotify-trend";

// Spotify Web API, app-only (client credentials): no user ever signs in.
// Terms that shape this file (developer.spotify.com/terms, checked 2026-10-12):
//  - IV.2.1.1: Spotify Content must never be fed into an AI model. Nothing from here goes to Gemini.
//  - IV.3.1.1 / IV.3.2: no indefinite storage, minimal caching. Callers keep links and counts only, and purge old rows.
// What this app can actually read (probed 2026-10-12): show name, description, artwork, total_episodes, languages;
// episode title, release date, duration, artwork. No followers, popularity, plays or likes for podcasts,
// no publisher field, search limit at most 10, and the batch endpoints answer 403.

const API = "https://api.spotify.com/v1";
const MARKET = "IN";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function spotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID?.trim() && process.env.SPOTIFY_CLIENT_SECRET?.trim());
}

let token: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Spotify token: HTTP ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return token.value;
}

export let spotifyCalls = 0;

async function sp<T>(path: string, params: Record<string, string>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(120); // stay well inside the rolling rate limit
    const res = await fetch(`${API}/${path}?${new URLSearchParams({ market: MARKET, ...params })}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    spotifyCalls++;
    if (res.ok) return res.json() as Promise<T>;
    if (res.status === 401) token = null;
    else if (res.status === 429) await sleep(Math.min(Number(res.headers.get("retry-after") ?? "2"), 30) * 1000);
    else if (res.status < 500) throw new Error(`Spotify ${path}: HTTP ${res.status}`);
    else await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`Spotify ${path}: gave up after retries`);
}

type Image = { url: string; width: number | null; height: number | null };
type RawShow = { id: string; name: string; description: string; images: Image[]; external_urls: { spotify: string }; total_episodes: number; languages: string[] };
type RawEpisode = { id: string; name: string; description: string; release_date: string; release_date_precision: string; duration_ms: number; external_urls: { spotify: string } };

export type SpotifyShow = { id: string; name: string; description: string; imageUrl: string | null; url: string; totalEpisodes: number; languages: string[] };
export type SpotifyEpisode = { id: string; title: string; description: string; publishedAt: Date; durationSeconds: number; url: string };

// Smallest artwork that is still at least 160 px: enough for a 56 px tile on a retina screen.
const pickImage = (images: Image[]) => [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find((i) => (i.width ?? 0) >= 160)?.url ?? images[0]?.url ?? null;

const toShow = (s: RawShow): SpotifyShow => ({ id: s.id, name: s.name, description: s.description ?? "", imageUrl: pickImage(s.images ?? []), url: s.external_urls.spotify, totalEpisodes: s.total_episodes ?? 0, languages: s.languages ?? [] });

/** Shows Spotify ranks for a query in the Indian market, in Spotify's order (the API allows at most 10). */
export async function searchShows(q: string, limit = 10): Promise<SpotifyShow[]> {
  const r = await sp<{ shows: { items: (RawShow | null)[] } }>("search", { q, type: "show", limit: String(Math.min(limit, 10)) });
  return r.shows.items.filter((s): s is RawShow => !!s).map(toShow);
}

/** Newest episodes of a show, newest first. 50 per call; stops paging once episodes are older than `since`. */
export async function showEpisodes(showId: string, max = 50, since?: Date): Promise<SpotifyEpisode[]> {
  const out: SpotifyEpisode[] = [];
  for (let offset = 0; offset < max; offset += 50) {
    if (since && out.length && out[out.length - 1].publishedAt < since) break;
    const r = await sp<{ items: (RawEpisode | null)[]; next: string | null }>(`shows/${showId}/episodes`, { limit: String(Math.min(50, max - offset)), offset: String(offset) });
    for (const e of r.items) {
      if (!e?.release_date) continue;
      // Only day-precision dates are usable for cadence and matching.
      if (e.release_date_precision !== "day") continue;
      out.push({ id: e.id, title: e.name, description: e.description ?? "", publishedAt: new Date(`${e.release_date}T00:00:00Z`), durationSeconds: Math.round((e.duration_ms ?? 0) / 1000), url: e.external_urls.spotify });
    }
    if (!r.next) break;
  }
  return out;
}

/** The Spotify show for a podcast we already know, by name. Callers confirm it by matching episodes before using it. */
export async function findShow(name: string): Promise<SpotifyShow | null> {
  return bestShowByName(name, await searchShows(name, 5));
}
