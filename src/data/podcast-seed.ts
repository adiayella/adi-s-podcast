// Starting list of monitored shows. Every feed below was fetched and checked on 2026-10-12.
// `enabled: true` marks the ten shows monitored by default; the rest are ready to switch on
// from the Manage Podcasts page.
export type SeedPodcast = {
  name: string;
  rssUrl: string;
  youtubeChannelId?: string;
  enabled: boolean;
};

export const SEED_PODCASTS: SeedPodcast[] = [
  // ---- default ten ----
  { name: "Figuring Out with Raj Shamani", rssUrl: "https://anchor.fm/s/f5347ab0/podcast/rss", youtubeChannelId: "UCzwCEE_PchiBULMnAJqhGVg", enabled: true },
  { name: "The Ranveer Show (Hindi)", rssUrl: "https://anchor.fm/s/f5d53400/podcast/rss", enabled: true },
  { name: "WTF is with Nikhil Kamath", rssUrl: "https://feeds.hubhopper.com/664690fdea0d7a6f61a052da119934d3.rss", enabled: true },
  { name: "SparX by Mukesh Bansal", rssUrl: "https://anchor.fm/s/f2929a94/podcast/rss", enabled: true },
  { name: "The Neon Show", rssUrl: "https://rss.buzzsprout.com/1601695.rss", enabled: true },
  { name: "Founder Thesis", rssUrl: "https://feeds.zencastr.com/f/mbqvPYFP.rss", enabled: true },
  { name: "The Indian Startup Show", rssUrl: "https://feeds.simplecast.com/6dj1W8C2", enabled: true },
  { name: "Prime Venture Partners Podcast", rssUrl: "https://feeds.captivate.fm/prime-venture-partners/", enabled: true },
  { name: "The Daily Brief (Zerodha)", rssUrl: "https://feeds.simplecast.com/1H1JSMd0", enabled: true },
  {
    name: "The Morning Brief (Economic Times)",
    rssUrl:
      "https://www.omnycontent.com/d/playlist/60b2e926-e5f8-4b90-a465-aef901163001/95fd7c59-790d-496e-bbde-aef901167fe4/8ae54763-9925-40ca-8c3d-aef901167ffb/podcast.rss",
    enabled: true,
  },
  // ---- verified reserves (disabled) ----
  { name: "The INDUStry Show", rssUrl: "https://anchor.fm/s/20707f90/podcast/rss", enabled: false },
  { name: "Indian Business Podcast (Thinkschool)", rssUrl: "https://anchor.fm/s/f4e896f4/podcast/rss", enabled: false },
  { name: "The Creator Room", rssUrl: "https://anchor.fm/s/10bec0278/podcast/rss", enabled: false },
  { name: "Entrepreneur's Live Interviews", rssUrl: "https://anchor.fm/s/33f31e38/podcast/rss", enabled: false },
  { name: "Network Capital", rssUrl: "https://anchor.fm/s/1f387a38/podcast/rss", enabled: false },
  { name: "The Ranveer Show (English)", rssUrl: "https://feeds.simplecast.com/7PWFZi_d", youtubeChannelId: "UCneyi-aYq4VIBYIAQgWmk_w", enabled: false },
  { name: "Finshots Daily", rssUrl: "https://anchor.fm/s/37a76020/podcast/rss", enabled: false },
  { name: "Daybreak (The Ken)", rssUrl: "https://feeds.transistor.fm/daybreak-3e66db67-ddb3-4cd3-9ba9-460bd586dcbb", enabled: false },
  { name: "Two by Two (The Ken)", rssUrl: "https://feeds.transistor.fm/two-by-two", enabled: false },
  { name: "The India FinTech Diaries", rssUrl: "https://anchor.fm/s/367c8004/podcast/rss", enabled: false },
  { name: "Moneycontrol Podcast", rssUrl: "https://audioboom.com/channels/4937727.rss", enabled: false },
  { name: "India Tech Report", rssUrl: "https://feeds.transistor.fm/india-tech-report", enabled: false },
  { name: "Not-So-Common Common Sense", rssUrl: "https://anchor.fm/s/b459c16c/podcast/rss", enabled: false },
  { name: "Fintech Ki Baat", rssUrl: "https://anchor.fm/s/550373c0/podcast/rss", enabled: false },
  { name: "Leadership Lounge (The CEO Magazine India)", rssUrl: "https://media.rss.com/leadership-lounge-with-the-ceo-magazine/feed.xml", enabled: false },
  { name: "The Collaborative Canvas Podcast", rssUrl: "https://api.riverside.fm/hosting/BlBsb6oj.rss", enabled: false },
  { name: "Knoodle Founders Hour", rssUrl: "https://anchor.fm/s/10d9ead14/podcast/rss", enabled: false },
];
