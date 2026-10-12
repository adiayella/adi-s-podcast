import { Suspense } from "react";
import { connection } from "next/server";
import { BadgeCheck, Link2, Megaphone, ShieldAlert } from "lucide-react";
import { Badge, EmptyState, KpiCard, PageHeader, PanelSkeleton } from "@/components/ui";
import { EpisodeLinks, ScoreCell, Tabs, withParam } from "@/components/radar-ui";
import { FilterForm } from "@/components/filter-form";
import { EvidenceSource } from "@/components/evidence-source";
import { formatDateIST } from "@/lib/format";
import { getEnabledPodcasts, getSponsorRadar, parsePeriod, type SponsorRow } from "@/services/radars";

export default function SponsorRadarPage({ searchParams }: PageProps<"/sponsors">) {
  return (
    <>
      <PageHeader
        title="Sponsor Radar"
        subtitle="Brands already paying for shows like Aditya's. A brand merely being mentioned is never counted as a sponsor."
      />
      <Suspense fallback={<PanelSkeleton className="h-[480px]" />}>
        <Radar searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const CLASS_LABEL: Record<string, string> = {
  explicit_sponsor: "Explicit sponsor",
  paid_promotion: "Paid promotion",
  possible_affiliate: "Promo link / code",
  unknown: "Unclear promo",
};

function Evidence({ s }: { s: SponsorRow }) {
  return (
    <EpisodeLinks
      summary={`${s.evidence.length} episode${s.evidence.length > 1 ? "s" : ""}`}
      items={s.evidence.map((e) => ({
        title: e.title,
        url: e.url,
        podcast: e.podcast,
        at: e.at,
        extra: (
          <div className="mt-1.5">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={e.class === "explicit_sponsor" || e.class === "paid_promotion" ? "good" : "neutral"}>{CLASS_LABEL[e.class] ?? e.class}</Badge>
              {e.flag && <Badge tone="warn">YouTube: paid placement</Badge>}
            </div>
            {e.quote && <p className="mt-1 text-xs text-muted italic">“{e.quote.slice(0, 200)}”</p>}
            <div className="mt-1"><EvidenceSource src={e.src} seconds={e.seconds} /></div>
          </div>
        ),
      }))}
    />
  );
}

function Table({ rows, kind }: { rows: SponsorRow[]; kind: "disclosed" | "promo" }) {
  return (
    <section className="overflow-x-auto rounded-2xl bg-panel p-2 ring-1 ring-line sm:p-4">
      <table className="w-full min-w-[960px] text-left text-[15px]">
        <thead className="text-sm text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-3 font-normal">Priority</th>
            <th className="px-3 py-3 font-normal">Brand</th>
            <th className="px-3 py-3 font-normal">{kind === "disclosed" ? "Disclosed (eps / shows)" : "Promo mentions"}</th>
            <th className="px-3 py-3 font-normal">YouTube paid flag</th>
            <th className="px-3 py-3 font-normal">Latest</th>
            <th className="px-3 py-3 font-normal">{kind === "disclosed" ? "Sponsor score" : "Promo signal"}</th>
            <th className="px-3 py-3 font-normal">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-b border-line/60 align-top">
              <td className="px-3 py-3.5">
                <Badge tone={s.tier === "A" ? "good" : s.tier === "B" ? "warn" : "neutral"}>Tier {s.tier}</Badge>
              </td>
              <td className="px-3 py-3.5">
                <p className="font-medium">{s.name}</p>
                <p className="text-sm text-muted">{s.category ?? "Category unknown"}</p>
                {s.focus && <div className="mt-1"><Badge tone="good">Matches your focus</Badge></div>}
              </td>
              <td className="px-3 py-3.5 tabular-nums">
                {kind === "disclosed" ? (
                  <>
                    {s.confirmedEpisodes} / {s.confirmedPodcasts}
                    {s.promoEpisodes > 0 && <p className="text-xs text-muted">+ {s.promoEpisodes} unverified</p>}
                  </>
                ) : (
                  <>
                    {s.promoEpisodes} on {s.distinctPodcasts} show{s.distinctPodcasts > 1 ? "s" : ""}
                  </>
                )}
              </td>
              <td className="px-3 py-3.5 tabular-nums">{s.platformFlaggedEpisodes > 0 ? `${s.platformFlaggedEpisodes} of ${s.totalEpisodes} eps` : <span className="text-muted">none</span>}</td>
              <td className="px-3 py-3.5 whitespace-nowrap text-muted">{formatDateIST(kind === "disclosed" && s.lastConfirmedAt ? s.lastConfirmedAt : s.lastAt)}</td>
              <td className="px-3 py-3.5">
                <ScoreCell
                  result={kind === "disclosed" ? s.score : s.signal}
                  raw={kind === "disclosed" ? <>Raw: {s.confirmedEpisodes} disclosed episode(s) on {s.confirmedPodcasts} show(s)</> : <>Raw: {s.totalEpisodes} promotional episode(s), none disclosed as sponsorship</>}
                />
              </td>
              <td className="px-3 py-3.5">
                <Evidence s={s} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

async function Radar({ searchParams }: { searchParams: PageProps<"/sponsors">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const period = parsePeriod(get("period") ?? "90d");
  const prioritise = get("focus") !== "off";
  const [brands, podcasts] = await Promise.all([getSponsorRadar({ period, podcastId: get("podcast") ? Number(get("podcast")) : undefined, prioritise }), getEnabledPodcasts()]);
  const current = { period: get("period"), podcast: get("podcast"), focus: get("focus") };
  const disclosed = brands.filter((b) => b.confirmedEpisodes > 0);
  const promo = brands.filter((b) => b.confirmedEpisodes === 0).sort((a, b) => b.platformFlaggedEpisodes - a.platformFlaggedEpisodes || b.signal.score - a.signal.score);
  const flagged = brands.filter((b) => b.platformFlaggedEpisodes > 0).length;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Period"
          current={period.key}
          options={[{ value: "30d", label: "30 days" }, { value: "90d", label: "90 days" }]}
          hrefFor={(v) => withParam("/sponsors", current, "period", v)}
        />
        <FilterForm basePath="/sponsors" params={current} podcasts={podcasts} podcast={get("podcast")} journalists={null} prioritise={prioritise} />
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <KpiCard label="Disclosed sponsors" value={disclosed.length} icon={BadgeCheck} hint="Text says “brought to you by” or paid partnership" />
        <KpiCard label="Unverified promotions" value={promo.length} icon={Link2} hint="Promo links or codes with no disclosure" />
        <KpiCard label="Backed by YouTube paid flag" value={flagged} icon={ShieldAlert} hint="Platform marks the video as paid placement" />
      </div>

      {brands.length === 0 ? (
        <EmptyState icon={Megaphone} title="No promotional evidence in this period">
          <p>Sponsor evidence only appears when an episode description names a brand with a promotional cue. Many shows do not disclose sponsors in text.</p>
        </EmptyState>
      ) : (
        <>
          {disclosed.length > 0 && (
            <div className="grid gap-3">
              <h2 className="text-lg font-semibold">Disclosed sponsors</h2>
              <Table rows={disclosed} kind="disclosed" />
            </div>
          )}
          {promo.length > 0 && (
            <div className="grid gap-3">
              <h2 className="text-lg font-semibold">Promotional mentions (unverified)</h2>
              <p className="-mt-1 text-sm text-muted">These brands are promoted with a link or code, but no text discloses a sponsorship. They do not count toward the sponsor score.</p>
              <Table rows={promo} kind="promo" />
            </div>
          )}
        </>
      )}

      <section className="rounded-2xl bg-panel p-5 text-sm leading-relaxed text-muted ring-1 ring-line">
        <h2 className="mb-2 text-base font-semibold text-ink">How outreach priority works</h2>
        <p>
          <b className="text-ink">Tier A:</b> disclosed as a sponsor on 2 or more shows. <b className="text-ink">Tier B:</b> disclosed on one show, or
          flagged by YouTube as paid placement on 2 or more episodes. <b className="text-ink">Tier C:</b> promo link or code only. The YouTube flag
          shows an episode contains a paid promotion; it does not say which brand paid, so it supports the evidence but never creates a sponsor on its
          own. Advertising spend is unknown and is not estimated.
        </p>
      </section>
    </div>
  );
}
