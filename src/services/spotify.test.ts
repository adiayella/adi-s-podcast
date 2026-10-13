import { afterEach, describe, expect, it, vi } from "vitest";

// A fake Spotify: the token always works, show lookups answer "quota exceeded, wait 11 hours", search works.
function fakeSpotify() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    if (url.includes("accounts.spotify.com")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    if (url.includes("/v1/shows/")) return new Response(JSON.stringify({ error: { status: 429, reason: "QUOTA_EXCEEDED" } }), { status: 429, headers: { "retry-after": "40613" } });
    return new Response(JSON.stringify({ shows: { items: [] } }), { status: 200 });
  });
  return calls;
}

describe("Spotify quota pause", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("stops calling a limited kind of request for the whole wait, and keeps the other kinds working", async () => {
    process.env.SPOTIFY_CLIENT_ID = "id";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
    const calls = fakeSpotify();
    const sp = await import("./spotify");

    await expect(sp.showEpisodes("abc")).rejects.toBeInstanceOf(sp.SpotifyPaused);
    const showCalls = () => calls.filter((c) => c.includes("/v1/shows/")).length;
    expect(showCalls()).toBe(1); // no retries against a multi-hour wait

    await expect(sp.showEpisodes("def")).rejects.toBeInstanceOf(sp.SpotifyPaused);
    expect(showCalls()).toBe(1); // later show lookups make no network call at all
    expect(sp.spotifyPausedUntil("shows")!.getTime()).toBeGreaterThan(Date.now() + 11 * 3_600_000 - 60_000);

    await expect(sp.searchShows("fintech")).resolves.toEqual([]); // search is limited separately and still works
    expect(sp.spotifyPausedUntil("search")).toBeNull();
  });
});
