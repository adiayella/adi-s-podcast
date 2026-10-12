import { Suspense } from "react";
import { connection } from "next/server";
import { Hash, Layers } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, PanelSkeleton } from "@/components/ui";
import { formatDateTimeIST } from "@/lib/format";
import { getSectorTrends } from "@/services/intelligence";
import { listClusters } from "@/services/semantic";

export default function SectorsPage() {
  return (
    <>
      <PageHeader title="Sector Intelligence" subtitle="Which topics are gaining momentum, how their episodes perform on YouTube, and what themes cut across shows." />
      <Suspense fallback={<PanelSkeleton className="h-96" />}>
        <Body />
      </Suspense>
    </>
  );
}

const tone = (l: string) => (l === "high" ? "good" : l === "medium" ? "warn" : "neutral");

async function Body() {
  await connection();
  const [sectors, clusters] = await Promise.all([getSectorTrends(), listClusters()]);
  const rows = sectors.filter((s) => s.episodesThisWeek + s.episodesPrevWeek > 0).sort((a, b) => Number(b.focus) - Number(a.focus) || b.episodesThisWeek - a.episodesThisWeek);
  return (
    <div className="grid gap-5">
      <Panel title="Topic momentum and engagement" icon={Hash}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead className="text-sm text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Sector</th>
                  <th className="py-2 pr-4 font-medium">Episodes this week vs last</th>
                  <th className="py-2 pr-4 font-medium">Engagement vs show norm</th>
                  <th className="py-2 pr-4 font-medium">Likes+comments per 1k views</th>
                  <th className="py-2 pr-4 font-medium">Views gained (7d)</th>
                  <th className="py-2 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => (
                  <tr key={s.name}>
                    <td className="py-3 pr-4 font-medium">
                      {s.name} {s.focus && <Badge tone="good">your focus</Badge>}
                    </td>
                    <td className="py-3 pr-4 tabular-nums">
                      {s.episodesThisWeek} vs {s.episodesPrevWeek} <span className={s.trend === "rising" || s.trend === "new" ? "text-good" : s.trend === "falling" ? "text-bad" : "text-muted"}>{s.trend}</span>
                    </td>
                    <td className="py-3 pr-4 tabular-nums">{s.perfIndex === null ? <span className="text-muted">not enough data</span> : `${s.perfIndex}×`}</td>
                    <td className="py-3 pr-4 tabular-nums">{s.per1k ?? <span className="text-muted">n/a</span>}</td>
                    <td className="py-3 pr-4 tabular-nums">{s.viewsGained7d === null ? <span className="text-muted">needs 2+ days of history</span> : s.viewsGained7d.toLocaleString("en-IN")}</td>
                    <td className="py-3">
                      <Badge tone={tone(s.confidence.level)}>{s.confidence.level}</Badge>
                      <p className="mt-1 text-xs text-muted">{s.confidence.reasons[0]}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Hash} title="No topic data yet">
            <p>Run the daily job to ingest and analyse episodes.</p>
          </EmptyState>
        )}
        <p className="mt-4 text-sm text-muted">
          <strong className="text-ink/90">Engagement vs show norm</strong> compares each episode’s views per day with other episodes of the same show at a similar age, so a small channel is not penalised for being small. 1.0× is typical. Episodes under 7 days old are not scored because early views are front-loaded. Share counts are not available from YouTube. Counts are public YouTube statistics.
        </p>
      </Panel>

      <Panel title="Themes found by meaning" icon={Layers} right={clusters[0] && <span className="text-sm text-muted">rebuilt {formatDateTimeIST(clusters[0].computedAt)} IST</span>}>
        {clusters.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {clusters.map((c) => (
              <div key={c.id} className="rounded-xl bg-panel2 p-4 ring-1 ring-line">
                <p className="font-semibold">{c.label}</p>
                <p className="mt-1 text-sm text-muted">
                  {c.episodeCount} episodes across {c.podcastCount} shows · {c.recentCount} in the last 14 days vs {c.priorCount} before · cohesion {c.cohesion.toFixed(2)}
                </p>
                <ul className="mt-3 grid gap-1.5 text-sm">
                  {c.samples.map((e) => (
                    <li key={e.title} className="text-ink/90">
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:decoration-accent">
                          {e.title}
                        </a>
                      ) : (
                        e.title
                      )}{" "}
                      <span className="text-muted">· {e.podcast}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">No theme spans three or more episodes on two or more shows yet.</p>
        )}
        <p className="mt-4 text-sm text-muted">Episodes are embedded as vectors and grouped by closeness of meaning; Gemini only names each group. Membership is arithmetic, not an AI opinion. Unlike the fixed topic list above, these can surface themes nobody listed in advance.</p>
      </Panel>
    </div>
  );
}
