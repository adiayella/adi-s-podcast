import { Badge } from "@/components/ui";
import { SPOTIFY_TREND_RUBRIC, type TrendLabel } from "@/discovery/spotify-trend";
import type { SpotifySectorTrend, SpotifyTrendShow } from "@/services/spotify-trends";

const compact = (n: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const LABEL_TONE: Record<TrendLabel, "good" | "warn" | "neutral" | "bad"> = { hot: "bad", rising: "good", steady: "warn", quiet: "neutral", "off-topic": "neutral" };
const HEAT_TONE = { "heating up": "good", steady: "warn", cooling: "bad", "too little data": "neutral" } as const;

function Artwork({ show }: { show: SpotifyTrendShow }) {
  if (!show.imageUrl) return <div className="size-12 shrink-0 rounded-lg bg-panel2 ring-1 ring-line" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={show.imageUrl} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-lg object-cover ring-1 ring-line" />
  );
}

function ShowRow({ show }: { show: SpotifyTrendShow }) {
  const m = show.metrics;
  return (
    <li className="flex gap-3 py-3">
      <Artwork show={show} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <a href={show.spotifyUrl} target="_blank" rel="noreferrer" className="line-clamp-1 font-medium hover:underline">
            {show.name}
          </a>
          <Badge tone={LABEL_TONE[show.label]}>
            {show.label} · {Math.round(show.score)}/100
          </Badge>
        </div>
        <p className="mt-0.5 text-sm text-muted">
          #{show.rank} on Spotify · {m.sectorEpisodes30d} sector episodes in 30 days (vs {m.sectorEpisodesPrev30d}) · {m.avgGapDays === null ? "cadence unknown" : m.avgGapDays < 1 ? "daily or more" : `every ${m.avgGapDays.toFixed(1)} days`} · {show.totalEpisodes.toLocaleString("en-IN")} episodes
          {show.languages.length ? ` · ${show.languages.join(", ")}` : ""}
        </p>
        {show.youtube && (
          <p className="mt-0.5 text-sm text-soft">
            YouTube: median {show.youtube.medianViews === null ? "n/a" : compact(show.youtube.medianViews)} views
            {show.youtube.medianLikes !== null ? `, ${compact(show.youtube.medianLikes)} likes` : ""} per video across {show.youtube.videos} recent videos
            {show.youtube.source === "monitored" ? " (a show you track)" : " (found by discovery)"}
          </p>
        )}
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">Score breakdown and episodes</summary>
          <ul className="mt-2 grid gap-1">
            {show.components.map((c) => (
              <li key={c.key} className="flex gap-2">
                <span className="w-14 shrink-0 tabular-nums text-ink/90">
                  {c.points}/{c.max}
                </span>
                <span>
                  <span className="text-ink/90">{c.label}:</span> <span className="text-muted">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {show.sampleEpisodes.length > 0 && (
            <ul className="mt-2 grid gap-1">
              {show.sampleEpisodes.map((e) => (
                <li key={e.url} className="line-clamp-1">
                  <a href={e.url} target="_blank" rel="noreferrer" className="text-soft hover:underline">
                    {e.title}
                  </a>{" "}
                  <span className="text-muted">· {e.date}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </li>
  );
}

export function SpotifyTrends({ sectors }: { sectors: SpotifySectorTrend[] }) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 lg:grid-cols-2">
        {sectors.map((s) => {
          const onTopic = s.shows.filter((x) => x.label !== "off-topic");
          const offTopic = s.shows.length - onTopic.length;
          return (
            <div key={s.sector} className="rounded-xl bg-panel2 p-4 ring-1 ring-line">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{s.sector}</p>
                <Badge tone={HEAT_TONE[s.heat.label]}>{s.heat.label}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">
                {s.heat.episodes30d} sector episodes in the last 30 days vs {s.heat.episodesPrev30d} before · {s.heat.hotOrRising} hot or rising of {onTopic.length} shows
              </p>
              <ul className="divide-y divide-line">
                {onTopic.slice(0, 5).map((show) => (
                  <ShowRow key={show.id} show={show} />
                ))}
              </ul>
              {offTopic > 0 && <p className="mt-1 text-xs text-muted">{offTopic} other show(s) Spotify returned had no episode on this sector in 90 days and are left out.</p>}
            </div>
          );
        })}
      </div>

      <details className="rounded-xl bg-panel2 p-4 text-sm ring-1 ring-line">
        <summary className="cursor-pointer font-medium">How the Spotify trend score works ({SPOTIFY_TREND_RUBRIC.version})</summary>
        <ul className="mt-3 grid gap-1.5">
          {SPOTIFY_TREND_RUBRIC.components.map((c) => (
            <li key={c.key}>
              <span className="font-medium text-ink/90">
                {c.label} ({c.max} pts):
              </span>{" "}
              <span className="text-muted">{c.rule}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-muted">
          Labels: {SPOTIFY_TREND_RUBRIC.labels.map((l) => `${l.label} = ${l.rule}`).join("; ")}.
        </p>
        <p className="mt-2 text-muted">
          A sector is <em>heating up</em> when its shows published 25%+ more sector episodes in the last 30 days than in the 30 before, and <em>cooling</em> at 20%+ fewer. Sector membership is a keyword rule on episode titles and descriptions; no AI reads Spotify data. {SPOTIFY_TREND_RUBRIC.notAvailable}
        </p>
      </details>
    </div>
  );
}
