import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Flame, Hash, TrendingUp } from "lucide-react";
import { Badge, EmptyState, KpiCard, PageHeader, PanelSkeleton } from "@/components/ui";
import { EpisodeLinks, Pct, ScoreCell, Sparkline } from "@/components/radar-ui";
import { FilterForm } from "@/components/filter-form";
import { getEnabledPodcasts, getTopicRadar } from "@/services/radars";
import { formatDateIST } from "@/lib/format";
import type { TopicTrend } from "@/scoring/trend";

export default function TopicRadarPage({ searchParams }: PageProps<"/topics">) {
  return (
    <>
      <PageHeader title="Topic Radar" subtitle="What several shows are covering at once. Ride the wave, or counter-programme it." />
      <Suspense fallback={<PanelSkeleton className="h-[480px]" />}>
        <Radar searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function Trend({ t }: { t: { trend: string; momentumPct: number | null; episodesThisWeek: number; trendDetail: TopicTrend } }) {
  const d = t.trendDetail;
  const why = (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-muted hover:text-ink">why</summary>
      <p className="mt-1 max-w-[260px] text-muted">{d.summary}</p>
      <ul className="mt-1 grid gap-0.5">
        {d.gates.map((g) => (
          <li key={g.key} className={g.met ? "text-good" : "text-muted"}>
            {g.met ? "✓" : "✗"} {g.label}: {g.detail}
          </li>
        ))}
      </ul>
    </details>
  );
  if (t.trend === "new")
    return (
      <div>
        <Badge tone="good">New this week</Badge>
        {why}
      </div>
    );
  const Icon = t.trend === "rising" ? ArrowUpRight : t.trend === "falling" ? ArrowDownRight : ArrowRight;
  const tone = t.trend === "rising" ? "text-good" : t.trend === "falling" ? "text-bad" : "text-muted";
  return (
    <div>
      <span className={`inline-flex items-center gap-1 ${tone}`}>
        <Icon size={16} />
        <span className="capitalize">{t.trend}</span>
        <span className="text-xs text-muted">
          {t.momentumPct === null ? "" : `${t.momentumPct > 0 ? "+" : ""}${Math.round(t.momentumPct)}% · `}
          {t.episodesThisWeek} vs normal {d.baseline}
        </span>
      </span>
      {why}
    </div>
  );
}

async function Radar({ searchParams }: { searchParams: PageProps<"/topics">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const podcast = Array.isArray(sp.podcast) ? sp.podcast[0] : sp.podcast;
  const prioritise = (Array.isArray(sp.focus) ? sp.focus[0] : sp.focus) !== "off";
  const [topics, podcasts] = await Promise.all([getTopicRadar({ podcastId: podcast ? Number(podcast) : undefined, prioritise }), getEnabledPodcasts()]);
  const rising = topics.filter((t) => t.trend === "rising" || t.trend === "new");
  const multi = topics.filter((t) => t.distinctPodcasts >= 3);

  return (
    <div className="grid gap-5">
      <FilterForm basePath="/topics" params={{ podcast, focus: prioritise ? undefined : "off" }} podcasts={podcasts} podcast={podcast} journalists={null} prioritise={prioritise} />

      <div className="grid gap-5 md:grid-cols-3">
        <KpiCard label="Topics active (30d)" value={topics.length} icon={Hash} hint="From a fixed list of 20 topics" />
        <KpiCard label="Covered by 3+ shows" value={multi.length} icon={Flame} hint={multi.slice(0, 2).map((t) => t.name).join(", ") || undefined} />
        <KpiCard label="Rising this week" value={rising.length} icon={TrendingUp} hint="Rising or new under the topic-trend rubric (vs each topic's 4-week normal)" />
      </div>

      {topics.length === 0 ? (
        <EmptyState icon={Hash} title="No topics in the last 30 days">
          <p>Topics appear once episodes from the monitored shows have been analysed.</p>
        </EmptyState>
      ) : (
        <section className="overflow-x-auto rounded-2xl bg-panel p-2 ring-1 ring-line sm:p-4" aria-label="Ranked topics">
          <table className="w-full min-w-[1000px] text-left text-[15px]">
            <thead className="text-sm text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-3 font-normal">#</th>
                <th className="px-3 py-3 font-normal">Topic</th>
                <th className="px-3 py-3 font-normal">Shows (30d)</th>
                <th className="px-3 py-3 font-normal">Episodes: week / month / 30d</th>
                <th className="px-3 py-3 font-normal">Momentum</th>
                <th className="px-3 py-3 font-normal">8 weeks</th>
                <th className="px-3 py-3 font-normal">Momentum score</th>
                <th className="px-3 py-3 font-normal">Confidence</th>
                <th className="px-3 py-3 font-normal">Episodes</th>
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.id} className="border-b border-line/60 align-top">
                  <td className="px-3 py-3.5 text-muted tabular-nums">{t.rank}</td>
                  <td className="px-3 py-3.5">
                    <p className="font-medium">{t.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">{t.focus && <Badge tone="good">Matches your focus</Badge>}{t.unexpected && (t.trend === "rising" || t.trend === "new") && <Badge tone="warn">Unexpected trend</Badge>}</div>
                    <p className="text-xs text-muted">last episode {formatDateIST(t.lastAt)}</p>
                  </td>
                  <td className="px-3 py-3.5">
                    <p className="font-semibold tabular-nums">{t.distinctPodcasts}</p>
                    <p className="max-w-[220px] text-xs text-muted">{t.podcasts.join(", ")}</p>
                  </td>
                  <td className="px-3 py-3.5 whitespace-nowrap tabular-nums">
                    {t.episodesThisWeek} / {t.episodesThisMonth} / {t.episodes30d}
                  </td>
                  <td className="px-3 py-3.5">
                    <Trend t={t} />
                  </td>
                  <td className="px-3 py-3.5">
                    <Sparkline points={t.weekly.map((w) => w.n)} />
                  </td>
                  <td className="px-3 py-3.5">
                    <ScoreCell
                      result={t.score}
                      raw={
                        <>
                          Raw: {t.distinctPodcasts} show(s), {t.episodesThisWeek} this week vs {t.episodesPrevWeek} the week before
                        </>
                      }
                    />
                  </td>
                  <td className="px-3 py-3.5">
                    <Pct value={t.confidence} />
                  </td>
                  <td className="px-3 py-3.5">
                    <EpisodeLinks summary={`${t.episodes.length} recent`} items={t.episodes} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="text-sm text-muted">
        Weeks are the last 7 days compared with the 7 days before. Counts are distinct episodes from monitored shows. Suggested content angles are
        written for the top topics in the Monday brief, kept separate from these database counts.
      </p>
    </div>
  );
}
