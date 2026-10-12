import { connection } from "next/server";
import { Suspense } from "react";
import { Check, Database, Globe, Mail, Radio, Sparkles, Video, X, Rss } from "lucide-react";
import { Badge, Panel, PanelSkeleton, PageHeader } from "@/components/ui";
import { formatDateTimeIST, timeAgo } from "@/lib/format";
import { getCoverage, getTranscriptStatus } from "@/lib/queries";
import { getRecipient } from "@/services/brief";
import { recentRuns } from "@/services/jobs";

// Shows whether each integration is configured. Secret values are never rendered.
async function Sources() {
  await connection();
  const set = (k: string) => Boolean(process.env[k]);
  const recipient = await getRecipient();
  const items = [
    { icon: Rss, name: "Podcast RSS feeds", detail: "Public feeds. No key required.", ok: true },
    { icon: Video, name: "YouTube Data API v3", detail: "Second episode source", ok: set("YOUTUBE_API_KEY") },
    { icon: Sparkles, name: "Gemini Flash", detail: `Model: ${process.env.GEMINI_MODEL ?? "gemini-3.5-flash"}`, ok: set("GEMINI_API_KEY") },
    { icon: Database, name: "Neon PostgreSQL", detail: "Episodes, entities, scores, reports", ok: set("DATABASE_URL") },
    { icon: Mail, name: "Resend email", detail: "Monday brief delivery", ok: set("RESEND_API_KEY") && Boolean(recipient) },
    { icon: Radio, name: "Spotify Web API", detail: "Exact episode links and the sector trend scan", ok: set("SPOTIFY_CLIENT_ID") && set("SPOTIFY_CLIENT_SECRET") },
    { icon: Globe, name: "Tavily web search", detail: "Live web context on the search page", ok: set("TAVILY_API_KEY") },
    { icon: Check, name: "Scheduled job secret", detail: "Protects the /api/cron endpoints", ok: set("CRON_SECRET") },
  ];
  return (
    <Panel title="Integrations">
      <ul className="divide-y divide-line">
        {items.map((i) => (
          <li key={i.name} className="flex items-center justify-between gap-4 py-3.5">
            <div className="flex items-center gap-3.5">
              <span className="grid size-9 place-items-center rounded-xl bg-accent/20 text-soft">
                <i.icon size={18} />
              </span>
              <div>
                <p className="font-medium">{i.name}</p>
                <p className="text-sm text-muted">{i.detail}</p>
              </div>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm ${i.ok ? "bg-good/15 text-good" : "bg-bad/15 text-bad"}`}>
              {i.ok ? <Check size={14} /> : <X size={14} />}
              {i.ok ? "Configured" : "Missing"}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function maskEmail(e: string | null) {
  if (!e) return "not set";
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}***@${d}`;
}

async function TranscriptPipeline() {
  await connection();
  const [status, coverage] = await Promise.all([getTranscriptStatus(), getCoverage()]);
  const n = (src: string, st: string) => status.find((x) => x.source === src && x.status === st)?.n ?? 0;
  const sources: { name: string; state: "active" | "gated" | "off"; detail: string }[] = [
    { name: "Creator-published transcripts (RSS)", state: "active", detail: `${n("rss_tag", "fetched")} fetched, ${n("rss_tag", "available")} waiting, ${n("rss_tag", "failed")} failed, ${n("rss_tag", "not_permitted")} not permitted. Used whenever a feed publishes a transcript link.` },
    { name: "Transcript pages linked in descriptions", state: "off", detail: "Not built. Some shows link a public transcript page; reading them would need an approved list of sites." },
    { name: "Licensed transcript provider", state: "off", detail: "Not configured. Needs an account and a read of the provider's licence before it can be switched on." },
    { name: "Audio transcription", state: "gated", detail: "Not built. Even when built it only runs for shows where you record that we have the rights, and outside Vercel." },
    { name: "YouTube captions", state: "off", detail: "Not used. The YouTube API only releases captions to a video's owner; this app uses YouTube for metadata, view counts and the paid-placement flag only." },
  ];
  const tone = { active: "good", gated: "warn", off: "neutral" } as const;
  return (
    <Panel title="Transcript enrichment">
      <p className="mb-4 text-[15px] text-muted">
        <b className="text-ink">{coverage.transcript} of {coverage.total}</b> monitored episodes are analysed from a transcript ({coverage.shows} show{coverage.shows === 1 ? "" : "s"}). All others fall back to titles and descriptions, so every episode is still analysed.
      </p>
      <ul className="divide-y divide-line">
        {sources.map((x) => (
          <li key={x.name} className="flex items-start justify-between gap-4 py-3">
            <div>
              <p className="font-medium">{x.name}</p>
              <p className="text-sm text-muted">{x.detail}</p>
            </div>
            <Badge tone={tone[x.state]}>{x.state === "active" ? "Active" : x.state === "gated" ? "Rights required" : "Off"}</Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

type Run = Awaited<ReturnType<typeof recentRuns>>[number];

function RunLog({ title, runs }: { title: string; runs: Run[] }) {
  return (
    <Panel title={title}>
      {runs.length === 0 ? (
        <p className="text-muted">No run recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {runs.map((r) => {
            const d = (r.detail ?? {}) as { error?: string; skipped?: string };
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm text-muted">
                    {formatDateTimeIST(r.startedAt)} IST · {timeAgo(r.startedAt)}
                    {r.finishedAt ? ` · took ${Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s` : ""}
                  </p>
                  {d.skipped && <p className="mt-0.5 text-sm text-muted">Skipped: {d.skipped}</p>}
                  {r.status === "error" && <p className="mt-1 text-sm text-bad">{String(d.error ?? "failed")}</p>}
                </div>
                <Badge tone={d.skipped ? "neutral" : r.status === "ok" ? "good" : r.status === "error" ? "bad" : "neutral"}>{d.skipped ? "skipped" : r.status}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

async function Delivery() {
  await connection();
  const [to, focused, discovery, weekly] = await Promise.all([getRecipient(), recentRuns("focused", 5), recentRuns("discovery", 5), recentRuns("weekly", 5)]);
  return (
    <div className="grid gap-5">
      <Panel title="Schedule and delivery">
        <ul className="grid gap-2.5 text-[15px]">
          <li className="flex justify-between gap-4"><span className="text-muted">Focused research</span><span>05:00 IST daily (runs as often as your setting allows)</span></li>
          <li className="flex justify-between gap-4"><span className="text-muted">Discovery research</span><span>04:00 IST daily (runs as often as your setting allows)</span></li>
          <li className="flex justify-between gap-4"><span className="text-muted">Monday brief</span><span>06:00 IST, Mondays</span></li>
          <li className="flex justify-between gap-4"><span className="text-muted">Brief recipient</span><span>{maskEmail(to)}</span></li>
        </ul>
        <p className="mt-3 text-sm text-muted">
          Cron times are set in <code>vercel.json</code>. Each research mode checks your saved frequency on every call and skips if it is not due yet.
          On the Hobby plan Vercel starts a daily job within the hour, so the brief lands between 06:00 and 06:59 IST, before 08:00. Email runs in Resend
          test mode, which delivers only to the account owner&apos;s address.
        </p>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-3">
        <RunLog title="Focused research runs" runs={focused} />
        <RunLog title="Discovery research runs" runs={discovery} />
        <RunLog title="Weekly brief runs" runs={weekly} />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Data Sources" subtitle="Where the data comes from and which integrations are connected." />
      <div className="grid gap-5">
        <Suspense fallback={<PanelSkeleton className="h-96" />}>
          <Sources />
        </Suspense>
        <Suspense fallback={<PanelSkeleton className="h-64" />}>
          <TranscriptPipeline />
        </Suspense>
        <Suspense fallback={<PanelSkeleton className="h-72" />}>
          <Delivery />
        </Suspense>
      </div>
    </>
  );
}
