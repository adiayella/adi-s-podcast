import { Suspense } from "react";
import { connection } from "next/server";
import { Repeat2, Sparkles, UserSearch, Users } from "lucide-react";
import { Badge, EmptyState, KpiCard, PageHeader, PanelSkeleton } from "@/components/ui";
import { EpisodeLinks, Pct, ScoreCell, Tabs, withParam } from "@/components/radar-ui";
import { FilterForm } from "@/components/filter-form";
import { formatDateIST } from "@/lib/format";
import { getEnabledPodcasts, getGuestRadar, getMonthsWithData, parsePeriod } from "@/services/radars";

type Search = PageProps<"/guests">["searchParams"];

export default function GuestRadarPage({ searchParams }: PageProps<"/guests">) {
  return (
    <>
      <PageHeader
        title="Guest Radar"
        subtitle="Who is doing the media rounds right now. Guests on several shows in the same month are the easiest to book."
      />
      <Suspense fallback={<PanelSkeleton className="h-[480px]" />}>
        <Radar searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const SHOW_ROWS = 40;

async function Radar({ searchParams }: { searchParams: Search }) {
  await connection();
  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const [months, podcasts] = await Promise.all([getMonthsWithData(), getEnabledPodcasts()]);
  const period = parsePeriod(get("period") ?? months[0]);
  const podcastId = get("podcast") ? Number(get("podcast")) : undefined;
  const journalists = get("journalists") === "1";
  const prioritise = get("focus") !== "off";
  const current = { period: get("period"), podcast: get("podcast"), journalists: get("journalists"), focus: get("focus") };

  const guests = await getGuestRadar({ period, podcastId, includeJournalists: journalists, prioritise });
  const repeat = guests.filter((g) => g.distinctPodcasts >= 2);
  const totalApps = guests.reduce((a, g) => a + g.appearances, 0);
  const collapsed = guests.reduce((a, g) => a + g.rawAppearances - g.appearances, 0);

  const options = [...months.slice(0, 4).map((m) => ({ value: m, label: parsePeriod(m).label })), { value: "90d", label: "Last 90 days" }];
  const tabValue = get("period") ?? months[0];

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs label="Period" options={options} current={tabValue} hrefFor={(v) => withParam("/guests", current, "period", v)} />
        <FilterForm basePath="/guests" params={current} podcasts={podcasts} podcast={get("podcast")} journalists={journalists} prioritise={prioritise} />
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <KpiCard label="Guests in period" value={guests.length} icon={Users} hint={`${totalApps} appearances${collapsed ? `, ${collapsed} re-upload${collapsed > 1 ? "s" : ""} counted once` : ""}`} />
        <KpiCard
          label={period.calendarMonth ? "On 2+ shows this month" : "On 2+ shows"}
          value={repeat.length}
          icon={Repeat2}
          hint={repeat.length ? repeat.map((g) => g.name).slice(0, 3).join(", ") : "No guest appeared on more than one show"}
        />
        <KpiCard label="Top-ranked guest" value={<span className="text-2xl">{guests[0]?.name ?? "—"}</span>} icon={Sparkles} hint={guests[0] ? `${guests[0].distinctPodcasts} show${guests[0].distinctPodcasts > 1 ? "s" : ""} · score ${guests[0].score.score}` : undefined} />
      </div>

      {guests.length === 0 ? (
        <EmptyState icon={UserSearch} title="No guests match these filters">
          <p>Try a longer period or switch to all podcasts. Guests come from episode titles and descriptions of the monitored shows.</p>
        </EmptyState>
      ) : (
        <section className="overflow-x-auto rounded-2xl bg-panel p-2 ring-1 ring-line sm:p-4" aria-label="Ranked guests">
          <table className="w-full min-w-[980px] text-left text-[15px]">
            <thead className="text-sm text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-3 font-normal">#</th>
                <th className="px-3 py-3 font-normal">Guest</th>
                <th className="px-3 py-3 font-normal">Shows</th>
                <th className="px-3 py-3 font-normal">Appear.</th>
                <th className="px-3 py-3 font-normal">Latest</th>
                <th className="px-3 py-3 font-normal">Activity score</th>
                <th className="px-3 py-3 font-normal">Confidence</th>
                <th className="px-3 py-3 font-normal">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {guests.slice(0, SHOW_ROWS).map((g) => (
                <tr key={g.id} className="border-b border-line/60 align-top">
                  <td className="px-3 py-3.5 text-muted tabular-nums">{g.rank}</td>
                  <td className="px-3 py-3.5">
                    <p className="font-medium">{g.name}</p>
                    <p className="text-sm text-muted">{[g.role, g.company].filter(Boolean).join(" · ") || "Role not stated"}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {g.focus && <Badge tone="good">Matches your focus</Badge>}
                      {g.category && <Badge>{g.category}</Badge>}
                      {g.repeatThisMonth && <Badge tone="good">Repeat this month</Badge>}
                      {g.newFace && <Badge tone="warn">New to radar</Badge>}
                      {g.likelyStaff && <Badge>Likely regular contributor</Badge>}
                      {g.needsReview && <Badge tone="bad">Needs review</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    <p className="font-semibold tabular-nums">{g.distinctPodcasts}</p>
                    <p className="max-w-[200px] text-xs text-muted">{g.podcasts.join(", ")}</p>
                  </td>
                  <td className="px-3 py-3.5 tabular-nums">{g.appearances}</td>
                  <td className="px-3 py-3.5 whitespace-nowrap text-muted">{formatDateIST(g.lastAt)}</td>
                  <td className="px-3 py-3.5">
                    <ScoreCell
                      result={g.score}
                      raw={
                        <>
                          Raw: {g.distinctPodcasts} show(s), {g.appearances} appearance(s)
                          {g.rawAppearances !== g.appearances ? ` (${g.rawAppearances} before the 7-day re-upload rule)` : ""}
                        </>
                      }
                    />
                  </td>
                  <td className="px-3 py-3.5">
                    <Pct value={g.confidence} />
                  </td>
                  <td className="px-3 py-3.5">
                    <EpisodeLinks
                      summary={`${g.episodes.length} episode${g.episodes.length > 1 ? "s" : ""}`}
                      items={g.episodes.map((e) => ({ ...e, extra: e.evidence ? <p className="mt-1 text-xs text-muted italic">“{e.evidence}”</p> : null }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {guests.length > SHOW_ROWS && <p className="px-3 py-3 text-sm text-muted">Showing the top {SHOW_ROWS} of {guests.length} guests.</p>}
        </section>
      )}

      <p className="text-sm text-muted">
        Counts use {period.label.toLowerCase()} in IST. The same guest on the same show within 7 days counts once. The score is computed from these
        counts with the weights shown under “how?”. It measures how active a guest is, not how good a fit they are for Aditya.
      </p>
    </div>
  );
}
