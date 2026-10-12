import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { BarChart3, CalendarClock, Hash, Megaphone, Newspaper, PieChart, Radio, UserSearch, Clock } from "lucide-react";
import { Badge, KpiCard, Panel, PanelSkeleton, PageHeader } from "@/components/ui";
import { RangeTabs } from "@/components/range-tabs";
import { ShareDonut, WeeklyEpisodesChart } from "@/components/charts";
import { PublishingHeatmap } from "@/components/heatmap";
import { formatDateIST, pctChange, timeAgo } from "@/lib/format";
import {
  getKpis,
  getLatestEpisodes,
  getPublishingHeatmap,
  getShowActivity,
  getWeeklySeries,
  parseRange,
} from "@/lib/queries";

export default function OverviewPage({ searchParams }: PageProps<"/">) {
  return (
    <>
      <Suspense fallback={<PanelSkeleton className="mb-6 h-20" />}>
        <Header searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton className="h-[420px]" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Header({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const range = parseRange((await searchParams).range);
  const k = await getKpis(range);
  return (
    <PageHeader
      title="Overview"
      subtitle={
        <>
          {k.podcastsEnabled} podcasts monitored · last sync {timeAgo(k.lastSyncAt)}
          {k.syncErrors > 0 && (
            <>
              {" "}
              · <Link href="/podcasts" className="text-bad underline">{k.syncErrors} sync error{k.syncErrors > 1 ? "s" : ""}</Link>
            </>
          )}
        </>
      }
      actions={<RangeTabs current={range} basePath="/" />}
    />
  );
}

async function Body({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const range = parseRange((await searchParams).range);
  const [k, weekly, shows, heat, latest] = await Promise.all([
    getKpis(range),
    getWeeklySeries(12),
    getShowActivity(range),
    getPublishingHeatmap(),
    getLatestEpisodes(10),
  ]);

  const top = shows.filter((s) => s.episodes > 0);
  const donut = [
    ...top.slice(0, 6).map((s) => ({ name: s.name, value: s.episodes })),
    ...(top.length > 6 ? [{ name: "Other shows", value: top.slice(6).reduce((a, s) => a + s.episodes, 0) }] : []),
  ];
  const maxShow = Math.max(1, ...shows.map((s) => s.episodes));
  const analysed = k.guests + k.topics + k.brands > 0;

  return (
    <div className="grid gap-5">
      <div className="grid gap-5 md:grid-cols-3">
        <KpiCard
          label={`Episodes · last ${range}d`}
          value={k.episodesInRange}
          icon={Newspaper}
          delta={{ pct: pctChange(k.episodesInRange, k.episodesPrevRange), label: `vs previous ${range} days` }}
          hint={`${k.episodesPrevRange} in the previous ${range} days`}
        />
        <KpiCard
          label="New this week"
          value={k.episodesLast7}
          icon={CalendarClock}
          delta={{ pct: pctChange(k.episodesLast7, k.episodesPrev7), label: "vs prior 7 days" }}
          hint={`${k.episodesPrev7} the week before`}
        />
        <KpiCard
          label="Active podcasts"
          value={`${k.podcastsEnabled}`}
          icon={Radio}
          hint={`${k.podcastsTotal - k.podcastsEnabled} more available to enable · ${k.episodesAll} episodes stored`}
        />
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {[
          { href: "/guests", label: "Guests tracked", v: k.guests, icon: UserSearch },
          { href: "/topics", label: "Topics detected", v: k.topics, icon: Hash },
          { href: "/sponsors", label: "Sponsor brands", v: k.brands, icon: Megaphone },
        ].map((r) => (
          <Link key={r.href} href={r.href} className="group rounded-2xl bg-panel p-5 ring-1 ring-line transition hover:ring-accent/50">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5 text-[15px] text-ink/90">
                <r.icon size={18} className="text-soft" /> {r.label}
              </span>
              {!analysed && <Badge>Awaiting NLP</Badge>}
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{r.v}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Panel title="Episodes per week" icon={BarChart3} right={<span className="text-sm text-muted">last 12 weeks · IST</span>}>
          <WeeklyEpisodesChart data={weekly} />
        </Panel>
        <Panel title="Share by show" icon={PieChart} right={<span className="text-sm text-muted">{range}d</span>}>
          {donut.length ? (
            <ShareDonut data={donut} total={k.episodesInRange} />
          ) : (
            <p className="py-10 text-center text-muted">No episodes in this range.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Show activity" icon={Radio} right={<Link href="/podcasts" className="text-sm text-soft hover:underline">Manage</Link>}>
          <ul className="grid gap-4">
            {shows.map((s) => (
              <li key={s.id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[15px]">
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 text-sm text-muted tabular-nums">
                    {s.episodes} ep · last {s.lastPublished ? timeAgo(s.lastPublished) : "—"}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-panel2">
                  <div className="h-2 rounded-full bg-gradient-to-r from-accent to-accent2" style={{ width: `${(s.episodes / maxShow) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="When shows publish" icon={Clock} right={<span className="text-sm text-muted">90d · IST</span>}>
          <PublishingHeatmap grid={heat} />
        </Panel>
      </div>

      <Panel title="Latest episodes" icon={Newspaper}>
        <ul className="divide-y divide-line">
          {latest.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
              <div className="min-w-0">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-[15px] hover:text-soft hover:underline">
                    {e.title}
                  </a>
                ) : (
                  <p className="line-clamp-2 text-[15px]">{e.title}</p>
                )}
                <p className="text-sm text-muted">{e.podcast}</p>
              </div>
              <span className="shrink-0 text-sm text-muted">{formatDateIST(e.publishedAt)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
