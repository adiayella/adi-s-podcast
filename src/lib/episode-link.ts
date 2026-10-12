// Spotify for Podcasters (anchor.fm) feeds still put podcasters.spotify.com/pod/show/... in each item's <link>,
// but those pages now redirect to creators.spotify.com and 404 (checked 2026-10-12). Linking them sends the
// reader to "The podcast you're looking for doesn't have any content yet".
const DEAD_EPISODE_LINK = /^https?:\/\/(podcasters|creators)\.spotify\.com\/pod\/|^https?:\/\/anchor\.fm\/[^/]+\/episodes\//i;

export function isDeadEpisodeLink(url: string | null | undefined): boolean {
  return !!url && DEAD_EPISODE_LINK.test(url);
}

// A Spotify episode search for the exact title: it finds the real episode without guessing its Spotify id.
export function spotifySearchUrl(title: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(title.trim())}/episodes`;
}

export function isSpotifySearchUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith("https://open.spotify.com/search/");
}

// The link to store for an episode: the feed's own link, unless it is known to be dead.
export function listenUrl(url: string | null | undefined, title: string): string | null {
  if (!url) return null;
  return isDeadEpisodeLink(url) ? spotifySearchUrl(title) : url;
}
