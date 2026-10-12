import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Activity, BarChart3, FileSearch, Flame, Grid3x3, Handshake, Play, Sparkles, UserRound } from "lucide-react";
import { Avatar, Thumb } from "@/components/avatar";
import { ConvergenceHeatmap } from "@/components/convergence-heatmap";
import { IntelligenceStrip } from "@/components/intelligence-strip";
import { EngagementChart, EvidenceTabs, SectorExplorer } from "@/components/overview-charts";
import { Sparkline } from "@/components/radar-ui";
import { Panel, PanelSkeleton } from "@/components/ui";
import { formatDateIST } from "@/lib/format";
import { compact, getConvergenceHeatmap, getEngagement, getEvidenceReview, getGuestTimeline, getOverviewKpis, getRecommendations, getSectorSeries, getSponsorTable } from "@/services/overview";

export default function OverviewPage() {
  return (
    <div className="grid gap-5">
      <Suspense fallback={<PanelSkeleton className="h-28" />}>
        <Kpis />
      </Suspense>
      <Suspense fallback={<PanelSkeleton className="h-40" />}>
        <IntelligenceStrip />
      </Suspense>
      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Suspense fallback={<PanelSkeleton className="h-[420px]" />}>
          <Heatmap />
        </Suspense>
        <Suspense fallback={<PanelSkeleton className="h-[420px]" />}>
          <Timeline />
        </Suspense>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_1.25fr]">
        <Suspense fallback={<PanelSkeleton className="h-96" />}>
          <Sponsors />
        </Suspense>
        <Suspense fallback={<PanelSkeleton className="h-96" />}>
          <Sectors />
        </Suspense>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Suspense fallback={<PanelSkeleton className="h-96" />}>
          <Engagement />
        </Suspense>
        <Suspense fallback={<PanelSkeleton className="h-96" />}>
          <Evidence />
        </Suspense>
        <Suspense fallback={<PanelSkeleton className="h-96" />}>
          <Recommendations />
        </Suspense>
      </div>
      <p className="text-xs text-muted">Every figure is read from this app’s own database. Views, likes and comments are public YouTube counts (shares are not available). Episode thumbnails are served by YouTube; portraits come from Wikipedia and are shown only when the page matches the guest’s name and company or role, otherwise initials appear.</p>
    </div>
  );
}

async function Kpis() {
  await connection();
  const kpis = await getOverviewKpis();
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => (
        <div key={k.key} className="rounded-2xl bg-panel p-4 ring-1 ring-line">
          <p className="text-sm text-muted">{k.label}</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <p className="text-2xl font-semibold tabular-nums">{k.value}</p>
            {k.spark && <Sparkline points={k.spark} width={64} height={26} />}
          </div>
          <p className="mt-1 text-xs text-muted">
            {k.delta ? (
              <span className={k.delta.pct >= 0 ? "text-good" : "text-bad"}>
                {k.delta.pct >= 0 ? "↑" : "↓"} {Math.abs(k.delta.pct).toFixed(0)}%
              </span>
            ) : null}{" "}
            {k.delta ? k.delta.label : k.note}
          </p>
        </div>
      ))}
    </div>
  );
}

async function Heatmap() {
  await connection();
  const heat = await getConvergenceHeatmap();
  return (
    <Panel title="Topic Convergence Heatmap" icon={Grid3x3} right={<span className="text-sm text-muted">last 90 days</span>}>
      <p className="-mt-2 mb-3 text-sm text-muted">Where conversations, guests and sponsors intersect. Each cell counts episodes tagged with both topics; hover for guests and sponsors.</p>
      <ConvergenceHeatmap heat={heat} />
    </Panel>
  );
}

async function Timeline() {
  await connection();
  const items = await getGuestTimeline(6);
  return (
    <Panel title="Guest Media-Round Timeline" icon={Flame} right={<Link href="/guests" className="text-sm text-soft hover:underline">View all</Link>}>
      <ol className="grid gap-3">
        {items.map((t) => (
          <li key={t.guestId} className="grid grid-cols-[auto_1fr] items-center gap-3">
            <Avatar name={t.name} src={t.photo} size={48} credit={t.photo ? "Wikipedia" : null} />
            <div className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-3 rounded-xl bg-panel2 p-2.5 ring-1 ring-line">
              <a href={t.url && /^https?:\/\//.test(t.url) ? t.url : undefined} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-3">
                <span className="relative shrink-0">
                  <Thumb videoId={t.videoId} alt={t.episode} className="h-12 w-20" />
                  {t.videoId && <Play size={14} className="absolute inset-0 m-auto text-white drop-shadow" fill="currentColor" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{t.name}</span>
                  <span className="block truncate text-xs text-muted">{[t.role, t.company].filter(Boolean).join(", ") || "role not stated"}</span>
                  <span className="block truncate text-xs text-ink/80">
                    {t.podcast} · {t.episode}
                  </span>
                </span>
              </a>
              <span className="text-right text-xs text-muted">
                <span className="block text-sm font-semibold text-ink tabular-nums">{t.views === null ? "n/a" : compact(t.views)}</span>
                views · {formatDateIST(t.at)}
                {t.minutes ? ` · ${t.minutes}m` : ""}
              </span>
            </div>
          </li>
        ))}
        {!items.length && <li className="text-sm text-muted">No guest appearances yet.</li>}
      </ol>
    </Panel>
  );
}

async function Sponsors() {
  await connection();
  const list = await getSponsorTable(8);
  return (
    <Panel title="Sponsor Intelligence" icon={Handshake} right={<Link href="/sponsors" className="text-sm text-soft hover:underline">View all</Link>}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Sponsor</th>
              <th className="py-2 pr-3 font-medium">Category</th>
              <th className="py-2 pr-3 font-medium">Shows</th>
              <th className="py-2 font-medium">Episodes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.map((s) => (
              <tr key={s.name}>
                <td className="py-2.5 pr-3 font-medium">
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={s.name} size={26} />
                    {s.name}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-muted">{s.category ?? "—"}</td>
                <td className="py-2.5 pr-3 tabular-nums">{s.shows}</td>
                <td className="py-2.5 tabular-nums">{s.episodes}</td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-muted">
                  No promotional evidence yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">Only “disclosed” means a sponsorship was stated on the show. Advertising spend is unknown.</p>
    </Panel>
  );
}

async function Sectors() {
  await connection();
  const data = await getSectorSeries(12, 5);
  return (
    <Panel title="Sector Trend Explorer" icon={Activity} right={<Link href="/sectors" className="text-sm text-soft hover:underline">Details</Link>}>
      <SectorExplorer data={data} />
    </Panel>
  );
}

async function Engagement() {
  await connection();
  const e = await getEngagement();
  const stat = (label: string, v: number) => (
    <div className="rounded-xl bg-panel2 p-3 ring-1 ring-line">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{compact(v)}</p>
    </div>
  );
  return (
    <Panel title="Engagement Analysis" icon={BarChart3} right={<span className="text-sm text-muted">last 90 days</span>}>
      <div className="mb-3 grid grid-cols-3 gap-3">
        {stat("Total views", e.views)}
        {stat("Total likes", e.likes)}
        {stat("Total comments", e.comments)}
      </div>
      <EngagementChart data={e} />
      <p className="mt-2 text-xs text-muted">Counts are grouped by the week each episode was published. Shares are not exposed by YouTube.</p>
    </Panel>
  );
}

async function Evidence() {
  await connection();
  const ev = await getEvidenceReview();
  return (
    <Panel title="Evidence Review" icon={FileSearch} right={<Link href="/sectors" className="text-sm text-soft hover:underline">View all</Link>}>
      <EvidenceTabs insights={ev.insights} quotes={ev.quotes} />
    </Panel>
  );
}

async function Recommendations() {
  await connection();
  const list = await getRecommendations(5);
  return (
    <Panel title="Outreach Recommendations" icon={Sparkles} right={<Link href="/outreach" className="text-sm text-soft hover:underline">View all</Link>}>
      <ul className="grid gap-3">
        {list.map((r) => (
          <li key={r.id} className="flex items-center gap-3">
            <Avatar name={r.name} src={r.photo} size={44} credit={r.photo ? "Wikipedia" : null} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{r.name}</p>
              <p className="truncate text-xs text-muted">{[r.role, r.company].filter(Boolean).join(", ") || "role not stated"}</p>
              <p className="mt-1 flex flex-wrap gap-1">
                {r.tags.slice(0, 2).map((t) => (
                  <span key={t} className="rounded bg-panel2 px-1.5 py-0.5 text-[10px] text-muted ring-1 ring-line">
                    {t}
                  </span>
                ))}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums text-good">{r.score.toFixed(0)}</p>
              <p className="text-[10px] text-muted">score · {r.level}</p>
            </div>
            <Link href="/outreach" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/85">
              Outreach
            </Link>
          </li>
        ))}
        {!list.length && <li className="text-sm text-muted">Scores appear after the daily job.</li>}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        <UserRound size={12} /> Score is the opportunity rubric (0–100), not a “match %”. Drafts are never sent automatically.
      </p>
    </Panel>
  );
}

