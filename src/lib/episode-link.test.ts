import { describe, expect, it } from "vitest";
import { isDeadEpisodeLink, isSpotifySearchUrl, listenUrl, spotifySearchUrl } from "./episode-link";

describe("episode links", () => {
  it("treats Spotify for Podcasters episode pages as dead", () => {
    expect(isDeadEpisodeLink("https://podcasters.spotify.com/pod/show/rajshamani/episodes/Some-Title-e3o6gbs")).toBe(true);
    expect(isDeadEpisodeLink("https://creators.spotify.com/pod/profile/rajshamani/episodes/Some-Title-e3o6gbs")).toBe(true);
    expect(isDeadEpisodeLink("https://anchor.fm/rajshamani/episodes/Some-Title-e3o6gbs")).toBe(true);
  });

  it("keeps working links", () => {
    expect(isDeadEpisodeLink("https://www.youtube.com/watch?v=abc")).toBe(false);
    expect(isDeadEpisodeLink("https://omny.fm/shows/x/y")).toBe(false);
    expect(isDeadEpisodeLink(null)).toBe(false);
    expect(listenUrl("https://audioboom.com/posts/1", "T")).toBe("https://audioboom.com/posts/1");
    expect(listenUrl(null, "T")).toBeNull();
  });

  it("replaces a dead link with a Spotify search for the exact title", () => {
    const u = listenUrl("https://podcasters.spotify.com/pod/show/x/episodes/y", "Memory Explained | FO571");
    expect(u).toBe(spotifySearchUrl("Memory Explained | FO571"));
    expect(u).toBe("https://open.spotify.com/search/Memory%20Explained%20%7C%20FO571/episodes");
    expect(isSpotifySearchUrl(u)).toBe(true);
  });
});
