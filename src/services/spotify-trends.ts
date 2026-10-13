import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SECTOR_SEARCH, SPOTIFY_TREND_RUBRIC, scoreShow, sectorHeat, type SectorHeat, type ShowTrend, type TrendLabel } from "@/discovery/spotify-trend";
// Calendar date in IST (YYYY-MM-DD), matching how daily snapshots are dated.
const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
import { normalize } from "@/nlp/verify";
import { TOPICS, type Topic } from "@/nlp/taxonomy";
import { searchShows, showEpisodes, SpotifyPaused, spotifyCalls, spotifyConfigured, type SpotifyEpisode } from "@/services/spotify";

// Spotify trend scan: for every sector, the shows Spotify ranks for it in India, scored on the Spotify trend rubric.
// Nothing here is sent to Gemini (Spotify Developer Terms IV.2.1.1). Rows older than 30 days are deleted (IV.3.1.1).

const { spotifySectorObservations: obs } = schema;
const KEEP_DAYS = 30;

export type SpotifyTrendRun = { configured: boolean; sectors: number; shows: number; skippedSectors: string[]; purged: number; spotifyCalls: number; errors: string[]; paused?: string };

export async function runSpotifyTrends(opts: { force?: boolean; budgetMs?: number; sectors?: Topic[]; now?: Date } = {}): Promise<SpotifyTrendRun> {
  const now = opts.now ?? new Date();
  const today = istDate(now);
  const started = Date.now();
  const callsBefore = spotifyCalls;
  const out: SpotifyTrendRun = { configured: spotifyConfigured(), sectors: 0, shows: 0, skippedSectors: [], purged: 0, spotifyCalls: 0, errors: [] };
  if (!out.configured) return out;

  const cutoff = istDate(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
  const purged = await db.delete(obs).where(lt(obs.observedOn, cutoff)).returning({ id: obs.id });
  out.purged = purged.length;

  // Weekly: a sector scanned in the last 6 days is skipped. A daily scan (about 175 calls) ran into Spotify's quota limit.
  const recent = istDate(new Date(now.getTime() - 6 * 86_400_000));
  const done = opts.force ? new Set<string>() : new Set((await db.selectDistinct({ s: obs.sector }).from(obs).where(gte(obs.observedOn, recent))).map((r) => r.s));
  const episodeCache = new Map<string, SpotifyEpisode[]>();
  const since = new Date(now.getTime() - 95 * 86_400_000);

  for (const sector of opts.sectors ?? TOPICS) {
    if (done.has(sector)) continue;
    if (Date.now() - started > (opts.budgetMs ?? 200_000)) {
      out.skippedSectors.push(sector);
      continue;
    }
    try {
      const shows = await searchShows(SECTOR_SEARCH[sector].query, 10);
      for (const [i, show] of shows.entries()) {
        let eps = episodeCache.get(show.id);
        if (!eps) {
          eps = await showEpisodes(show.id, 150, since);
          episodeCache.set(show.id, eps);
        }
        const earlier = await db
          .select({ total: obs.totalEpisodes })
          .from(obs)
          .where(and(eq(obs.spotifyShowId, show.id), lt(obs.observedOn, today)))
          .orderBy(obs.observedOn);
        const t = scoreShow({ sector, rank: i + 1, episodes: eps, totalEpisodes: show.totalEpisodes, earlierTotals: earlier.map((e) => e.total), now });
        const row = {
          sector,
          observedOn: today,
          rank: i + 1,
          spotifyShowId: show.id,
          name: show.name,
          imageUrl: show.imageUrl,
          spotifyUrl: show.url,
          totalEpisodes: show.totalEpisodes,
          languages: show.languages,
          score: t.score,
          label: t.label,
          components: t.components,
          metrics: t.metrics,
          sampleEpisodes: t.sampleEpisodes,
          rubricVersion: SPOTIFY_TREND_RUBRIC.version,
        };
        await db.insert(obs).values(row).onConflictDoUpdate({ target: [obs.sector, obs.spotifyShowId, obs.observedOn], set: { ...row, createdAt: new Date() } });
        out.shows++;
      }
      out.sectors++;
    } catch (e) {
      if (e instanceof SpotifyPaused) {
        // Spotify asked us to wait for hours: stop here, keep the last good scan, try again on a later run.
        out.paused = e.message;
        break;
      }
      out.errors.push(`${sector}: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    }
  }
  out.spotifyCalls = spotifyCalls - callsBefore;
  return out;
}

// ---------------------------------------------------------------- read side (for the Sectors page)

export type YoutubeSide = { source: "monitored" | "discovery"; medianViews: number | null; medianLikes: number | null; videos: number };

export type SpotifyTrendShow = {
  id: string;
  name: string;
  imageUrl: string | null;
  spotifyUrl: string;
  rank: number;
  totalEpisodes: number;
  languages: string[];
  score: number;
  label: TrendLabel;
  components: ShowTrend["components"];
  metrics: ShowTrend["metrics"];
  sampleEpisodes: ShowTrend["sampleEpisodes"];
  youtube: YoutubeSide | null;
};

export type SpotifySectorTrend = { sector: string; observedOn: string; heat: SectorHeat; shows: SpotifyTrendShow[] };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** YouTube views and likes for shows we already track, keyed by normalised show name. Only real counts. */
async function youtubeByName(): Promise<Map<string, YoutubeSide>> {
  const map = new Map<string, YoutubeSide>();
  const monitored = (
    await db.execute(sql`
      select p.name, m.views, m.likes
      from podcasts p
      join episodes e on e.podcast_id = p.id and e.published_at > now() - interval '90 days'
      join episode_sources s on s.episode_id = e.id and s.kind = 'youtube'
      join lateral (select views, likes from episode_metric_snapshots where episode_source_id = s.id and views is not null order by captured_on desc limit 1) m on true`)
  ).rows as { name: string; views: number; likes: number | null }[];
  const grouped = new Map<string, { views: number[]; likes: number[] }>();
  for (const r of monitored) {
    const g = grouped.get(r.name) ?? { views: [], likes: [] };
    g.views.push(Number(r.views));
    if (r.likes !== null) g.likes.push(Number(r.likes));
    grouped.set(r.name, g);
  }
  for (const [name, g] of grouped) map.set(normalize(name), { source: "monitored", medianViews: median(g.views), medianLikes: median(g.likes), videos: g.views.length });

  const disc = await db.select({ name: schema.discoveryCandidates.name, engagement: schema.discoveryCandidates.engagement }).from(schema.discoveryCandidates);
  for (const c of disc) {
    const e = c.engagement as { videos?: number; medianViews?: number | null } | null;
    const key = normalize(c.name);
    if (e?.videos && !map.has(key)) map.set(key, { source: "discovery", medianViews: e.medianViews ?? null, medianLikes: null, videos: e.videos });
  }
  return map;
}

const HEAT_ORDER = { "heating up": 0, steady: 1, cooling: 2, "too little data": 3 } as const;

export async function getSpotifyTrends(): Promise<SpotifySectorTrend[]> {
  const [latest] = await db.select({ d: obs.observedOn }).from(obs).orderBy(desc(obs.observedOn)).limit(1);
  if (!latest) return [];
  // The newest observation of each sector within the last 14 days: scans are weekly, and a scan Spotify paused
  // must not empty the page. Older rows are purged at 30 days.
  const since14 = istDate(new Date(Date.now() - 14 * 86_400_000));
  const rows = await db.select().from(obs).where(gte(obs.observedOn, since14)).orderBy(desc(obs.observedOn), obs.rank);
  const yt = await youtubeByName();
  const bySector = new Map<string, typeof rows>();
  for (const r of rows) {
    const cur = bySector.get(r.sector);
    if (cur && cur[0].observedOn !== r.observedOn) continue;
    bySector.set(r.sector, [...(cur ?? []), r]);
  }
  const out: SpotifySectorTrend[] = [];
  for (const [sector, list] of bySector) {
    const shows: SpotifyTrendShow[] = list.map((r) => ({
      id: r.spotifyShowId,
      name: r.name,
      imageUrl: r.imageUrl,
      spotifyUrl: r.spotifyUrl,
      rank: r.rank,
      totalEpisodes: r.totalEpisodes,
      languages: r.languages as string[],
      score: r.score,
      label: r.label as TrendLabel,
      components: r.components as ShowTrend["components"],
      metrics: r.metrics as ShowTrend["metrics"],
      sampleEpisodes: r.sampleEpisodes as ShowTrend["sampleEpisodes"],
      youtube: yt.get(normalize(r.name)) ?? null,
    }));
    shows.sort((a, b) => b.score - a.score);
    out.push({ sector, observedOn: list[0].observedOn, heat: sectorHeat(shows.map((s) => ({ score: s.score, label: s.label, sectorEpisodes30d: s.metrics.sectorEpisodes30d, sectorEpisodesPrev30d: s.metrics.sectorEpisodesPrev30d }))), shows });
  }
  return out.sort((a, b) => HEAT_ORDER[a.heat.label] - HEAT_ORDER[b.heat.label] || b.heat.episodes30d - a.heat.episodes30d);
}
