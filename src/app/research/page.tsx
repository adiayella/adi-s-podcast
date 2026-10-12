import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Compass, History, Lightbulb, Megaphone, Radar, SlidersHorizontal, Users } from "lucide-react";
import { Badge, EmptyState, Panel, PanelSkeleton, PageHeader } from "@/components/ui";
import { Tabs, withParam } from "@/components/radar-ui";
import { Watchlist } from "@/components/podcast-watchlist";
import { PreferencesForm, RestoreButton, ReviewButtons, RunButton } from "@/components/research-controls";
import { isAdmin } from "@/lib/admin";
import { unitsUsedToday } from "@/lib/api-budget";
import { formatDateIST, formatDateTimeIST, timeAgo } from "@/lib/format";
import { effortBudget, FREQUENCIES } from "@/research/config";
import { candidateCounts, discoverySponsors, emergingThemes, foundersAcrossShows, listCandidates, type CandidateRow } from "@/services/discovery-queries";
import { recentRuns } from "@/services/job-log";
import { getActiveConfig, listVersions } from "@/services/research-settings";
import { getEnabledPodcasts } from "@/services/radars";

export const maxDuration = 300; // "Run now" buttons run a whole research job inside this request

export default function ResearchPage({ searchParams }: PageProps<"/research">) {
  return (
    <>
      <PageHeader title="Research Control Center" subtitle="Say what to focus on, and let the system also find opportunities you may be missing." />
      <Suspense fallback={<PanelSkeleton className="h-[520px]" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const freqLabel = (v: string) => FREQUENCIES.find((f) => f.value === v)?.label ?? v;

async function Body({ searchParams }: { searchParams: PageProps<"/research">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const tab = get("tab") === "discovery" ? "discovery" : "focused";
  const { version, config } = await getActiveConfig();
  const current = { tab: get("tab"), view: get("view") };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Research mode"
          current={tab}
          options={[{ value: "focused", label: "Focused Research" }, { value: "discovery", label: "Discovery Research" }]}
          hrefFor={(v) => withParam("/research", current, "tab", v)}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Research mode status">
          <Badge tone={config.modes.focused.enabled ? "good" : "neutral"}>Focused {config.modes.focused.enabled ? "on" : "off"} · {config.effort.focused}%</Badge>
          <Badge tone={config.modes.discovery.enabled ? "good" : "neutral"}>Discovery {config.modes.discovery.enabled ? "on" : "off"} · {config.effort.discovery}%</Badge>
          <span className="text-muted">settings v{version}</span>
        </div>
      </div>
      {tab === "focused" ? <Focused /> : <Discovery view={get("view") ?? "new"} current={current} />}
    </div>
  );
}

// ------------------------------------------------------------------ Focused Research
async function Focused() {
  const admin = await isAdmin();
  const [{ version, config }, versions, podcasts, runs] = await Promise.all([getActiveConfig(), listVersions(6), getEnabledPodcasts(), recentRuns("focused", 4)]);
  return (
    <div className="grid gap-5">
      <p className="rounded-2xl bg-panel p-4 text-[15px] text-muted ring-1 ring-line">
        <b className="text-ink">Source universe: your monitored podcasts only.</b> Focused Research ranks guests, topics and sponsors from the shows on your watchlist,
        prioritising what matches your preferences. Shows that do not match are still checked, so unexpected trends can surface.
      </p>

      <Panel title="Research preferences" icon={SlidersHorizontal} right={!admin && <Link href="/admin" className="text-sm text-soft hover:underline">Sign in as admin to edit</Link>}>
        <PreferencesForm config={config} version={version} podcasts={podcasts} canEdit={admin} />
      </Panel>

      <Panel title="Active watchlist" icon={Radar}>
        <Watchlist />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Settings history" icon={History}>
          <ul className="divide-y divide-line">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
                <div>
                  <p>Version {v.version}{v.version === version && <span className="ml-2"><Badge tone="good">active</Badge></span>}</p>
                  <p className="text-sm text-muted">{formatDateTimeIST(v.createdAt)} IST{v.note ? ` · ${v.note}` : ""}</p>
                </div>
                {admin && v.version !== version && <RestoreButton version={v.version} />}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Focused research runs">
          {admin && <div className="mb-4"><RunButton label="Run focused research now" mode="focused" /></div>}
          <p className="mb-3 text-sm text-muted">Monitors the watchlist {freqLabel(config.frequency.focused).toLowerCase()}. A run starts only when it is due.</p>
          <ul className="divide-y divide-line">
            {runs.length === 0 && <li className="py-2 text-muted">No run recorded yet.</li>}
            {runs.map((r) => {
              const d = (r.detail ?? {}) as { skipped?: string; error?: string };
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span>{formatDateTimeIST(r.startedAt)} IST · {timeAgo(r.startedAt)}{d.skipped ? ` · ${d.skipped}` : ""}{d.error ? ` · ${d.error}` : ""}</span>
                  <Badge tone={d.skipped ? "neutral" : r.status === "ok" ? "good" : "bad"}>{d.skipped ? "skipped" : r.status}</Badge>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Discovery Research
function CandidateCard({ c, admin }: { c: CandidateRow; admin: boolean }) {
  const m = c.metrics;
  const trending = c.trendLabel === "trending";
  return (
    <article className="rounded-2xl bg-panel p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{c.name}</h3>
          <p className="text-sm text-muted">{[c.publisher, c.genre, c.language && c.language.toUpperCase()].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={trending ? "good" : "neutral"}>{trending ? "Trending" : "Active and relevant"}</Badge>
          <Badge>{c.source === "apple" ? "Found in Apple Podcasts" : "Found on YouTube"}</Badge>
          <span className="rounded-lg bg-accent/20 px-2.5 py-1 text-sm font-semibold tabular-nums" title="Relevance to your interests, 0 to 100">Relevance {Math.round(c.relevance ?? 0)}</span>
        </div>
      </div>

      <p className="mt-3 text-[15px] leading-relaxed text-ink/90"><b>Why it is relevant:</b> {c.reason}</p>

      {c.relevanceDetail && c.relevanceDetail.matchedInterests.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">{c.relevanceDetail.matchedInterests.map((i) => <Badge key={i} tone="good">{i}</Badge>)}</div>
      )}

      {m && (
        <p className="mt-3 text-sm text-muted">
          {m.episodes30d} episodes in the last 30 days · {m.episodes90d} in 90 days · {m.relevantEpisodes90d} match your focus (last 30 days {m.relevantEpisodes30d}, the 30 days before {m.relevantEpisodesPrev30d})
          {c.engagement?.medianViews ? ` · median ${Math.round(c.engagement.medianViews).toLocaleString("en-IN")} views per video` : ""}
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-soft hover:underline">Is it really trending? ({c.trendEvidence?.signalsMet ?? 0} of 3 signals met)</summary>
        <ul className="mt-2 grid gap-1.5 text-sm">
          {c.trendEvidence?.signals.map((s) => (
            <li key={s.name} className={s.met ? "text-good" : "text-muted"}>{s.met ? "✓" : "✗"} <b>{s.name}</b>: {s.detail}</li>
          ))}
          <li className="text-muted">A show needs growth in relevant episodes plus one more independent signal. Popularity or one recent video is never enough.</li>
        </ul>
      </details>

      {c.evidenceEpisodes && c.evidenceEpisodes.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-soft hover:underline">Evidence: recent relevant episodes</summary>
          <ul className="mt-2 grid gap-1 text-sm">
            {c.evidenceEpisodes.map((e, i) => (
              <li key={i}>{e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="text-soft hover:underline">{e.title}</a> : e.title} <span className="text-muted">· {formatDateIST(e.at)}</span></li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 border-t border-line pt-4">
        {admin ? (
          <ReviewButtons id={c.id} status={c.status} canApprove={Boolean(c.rssUrl)} noFeedReason="No RSS feed is known for this show yet, so it cannot be collected. Add its feed URL in the watchlist first." />
        ) : (
          <p className="text-sm text-muted"><Link href="/admin" className="text-soft hover:underline">Sign in as admin</Link> to approve, save, dismiss or exclude. Nothing is added to your watchlist without your approval.</p>
        )}
      </div>
    </article>
  );
}

async function Discovery({ view, current }: { view: string; current: Record<string, string | undefined> }) {
  const admin = await isAdmin();
  const { config } = await getActiveConfig();
  const budget = effortBudget(config);
  const [counts, used, runs, themes, founders, sponsors] = await Promise.all([candidateCounts(), unitsUsedToday(), recentRuns("discovery", 4), emergingThemes(config), foundersAcrossShows(), discoverySponsors()]);
  const statuses = view === "saved" ? ["saved"] : view === "history" ? ["dismissed", "excluded", "approved"] : ["new"];
  const candidates = await listCandidates(statuses);
  const withStatus = view === "history" ? candidates : candidates;
  const lastRun = runs.find((r) => !((r.detail ?? {}) as { skipped?: string }).skipped);

  return (
    <div className="grid gap-5">
      <p className="rounded-2xl bg-panel p-4 text-[15px] text-muted ring-1 ring-line">
        <b className="text-ink">Source universe: shows outside your watchlist.</b> Everything on this tab comes from podcasts that are <i>not</i> monitored. It is kept completely
        separate from your monitored rankings and counts. Nothing is added to your watchlist unless you approve it.
      </p>

      <Panel title="Discovery status" icon={Compass}>
        <div className="grid gap-4 md:grid-cols-4">
          <div><p className="text-sm text-muted">Mode</p><p className="font-semibold">{config.modes.discovery.enabled ? "On" : "Off"} · {freqLabel(config.frequency.discovery)}</p></div>
          <div><p className="text-sm text-muted">Effort share</p><p className="font-semibold">{config.effort.discovery}% of research</p></div>
          <div><p className="text-sm text-muted">YouTube units today</p><p className="font-semibold tabular-nums">{used.toLocaleString("en-IN")} used · {budget.discoveryYoutubeUnits.toLocaleString("en-IN")} allotted per run</p></div>
          <div><p className="text-sm text-muted">Last run</p><p className="font-semibold">{lastRun ? timeAgo(lastRun.startedAt) : "never"}</p></div>
        </div>
        <p className="mt-3 text-sm text-muted">Searches use these interests: {config.keywords.concat(config.founders, config.companies, config.products, config.categories).slice(0, 8).join(", ") || "none set"}. Change them in Focused Research.</p>
        {admin && <div className="mt-4"><RunButton label="Run discovery now" mode="discovery" /></div>}
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Review queue"
          current={view}
          options={[{ value: "new", label: `Review queue (${counts.new ?? 0})` }, { value: "saved", label: `Saved for later (${counts.saved ?? 0})` }, { value: "history", label: `Decided (${(counts.dismissed ?? 0) + (counts.excluded ?? 0) + (counts.approved ?? 0)})` }]}
          hrefFor={(v) => withParam("/research", { ...current, tab: "discovery" }, "view", v === "new" ? null : v)}
        />
      </div>

      {withStatus.length === 0 ? (
        <EmptyState icon={Compass} title={view === "new" ? "No podcasts waiting for review" : "Nothing here"}>
          <p>{view === "new" ? "Run discovery to search for podcasts that match your interests. Candidates only appear when their real recent episodes match what you asked for." : "Decisions you make in the review queue are listed here."}</p>
        </EmptyState>
      ) : view === "history" ? (
        <Panel title="Decisions">
          <ul className="divide-y divide-line">
            {withStatus.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[15px]">
                <span>{c.name}</span>
                <span className="flex items-center gap-3"><Badge tone={c.status === "approved" ? "good" : "neutral"}>{c.status}</Badge>{admin && c.status !== "approved" && <ReviewButtons id={c.id} status="saved" canApprove={Boolean(c.rssUrl)} noFeedReason="No RSS feed known." />}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <div className="grid gap-4">{withStatus.map((c) => <CandidateCard key={c.id} c={c} admin={admin} />)}</div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title="Emerging themes" icon={Lightbulb}>
          <p className="mb-3 text-sm text-muted">Topics and phrases recurring across discovered shows that you have not asked for.</p>
          {themes.length === 0 ? <p className="text-muted">Not enough overlapping coverage across discovered shows yet.</p> : (
            <ul className="grid gap-3">
              {themes.map((t) => (
                <li key={t.theme}>
                  <p className="font-medium capitalize">{t.theme} <span className="text-xs font-normal text-muted">({t.kind})</span></p>
                  <p className="text-sm text-muted">{t.shows} shows · {t.episodes} episodes · {t.recent} in the last 30 days</p>
                  {t.examples[0] && <p className="line-clamp-1 text-sm">{t.examples[0].url ? <a href={t.examples[0].url} target="_blank" rel="noreferrer" className="text-soft hover:underline">{t.examples[0].title}</a> : t.examples[0].title}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Founders across discovered shows" icon={Users}>
          {founders.repeaters.length === 0 ? (
            <p className="text-muted">No founder has appeared on two or more discovered shows yet.</p>
          ) : (
            <ul className="grid gap-3">
              {founders.repeaters.map((f) => (
                <li key={f.name}><p className="font-medium">{f.name}</p><p className="text-sm text-muted">{[f.role, f.company].filter(Boolean).join(", ")} · on {f.shows.join(", ")}</p></li>
              ))}
            </ul>
          )}
          {founders.recent.length > 0 && (
            <details className="mt-4"><summary className="cursor-pointer text-sm text-soft hover:underline">Seen on one discovered show ({founders.recent.length})</summary>
              <ul className="mt-2 grid gap-1.5 text-sm">{founders.recent.map((f) => <li key={f.name}>{f.name} <span className="text-muted">· {f.shows[0]}</span></li>)}</ul>
            </details>
          )}
        </Panel>
        <Panel title="Sponsorship opportunities" icon={Megaphone}>
          <p className="mb-3 text-sm text-muted">Promotions found in discovered shows, with the quoted evidence. Unverified unless a disclosure is quoted.</p>
          {sponsors.length === 0 ? <p className="text-muted">No promotional evidence found in discovered shows yet.</p> : (
            <ul className="grid gap-3">
              {sponsors.map((s) => (
                <li key={s.brand}>
                  <p className="font-medium">{s.brand} <Badge tone={s.classification === "explicit_sponsor" || s.classification === "paid_promotion" ? "good" : "neutral"}>{s.classification === "explicit_sponsor" ? "Explicit sponsor" : s.classification === "paid_promotion" ? "Paid promotion" : "Promo link or code"}</Badge></p>
                  <p className="text-sm text-muted">{s.shows.join(", ")}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm italic text-ink/80">“{s.quote.slice(0, 160)}”</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
