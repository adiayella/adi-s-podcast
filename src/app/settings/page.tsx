import { connection } from "next/server";
import { Suspense } from "react";
import { Check, Database, Mail, Sparkles, Video, X, Rss } from "lucide-react";
import { Badge, Panel, PanelSkeleton, PageHeader } from "@/components/ui";
import { formatDateTimeIST, timeAgo } from "@/lib/format";
import { getRecipient } from "@/services/brief";
import { recentRuns } from "@/services/jobs";

// Shows whether each integration is configured. Secret values are never rendered.
async function Sources() {
  await connection();
  const set = (k: string) => Boolean(process.env[k]);
  const items = [
    { icon: Rss, name: "Podcast RSS feeds", detail: "Public feeds. No key required.", ok: true },
    { icon: Video, name: "YouTube Data API v3", detail: "Second episode source", ok: set("YOUTUBE_API_KEY") },
    { icon: Sparkles, name: "Gemini Flash", detail: `Model: ${process.env.GEMINI_MODEL ?? "gemini-3.5-flash"}`, ok: set("GEMINI_API_KEY") },
    { icon: Database, name: "Neon PostgreSQL", detail: "Episodes, entities, scores, reports", ok: set("DATABASE_URL") },
    { icon: Mail, name: "Resend email", detail: "Monday brief delivery", ok: set("RESEND_API_KEY") && set("BRIEF_TO_EMAIL") },
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

async function Delivery() {
  await connection();
  const [to, runs] = await Promise.all([getRecipient(), recentRuns(8)]);
  return (
    <div className="grid gap-5">
      <Panel title="Schedule and delivery">
        <ul className="grid gap-2.5 text-[15px]">
          <li className="flex justify-between gap-4"><span className="text-muted">Daily collection and analysis</span><span>05:00 IST (Vercel Cron, 23:30 UTC)</span></li>
          <li className="flex justify-between gap-4"><span className="text-muted">Monday brief</span><span>06:00 IST, Mondays (00:30 UTC)</span></li>
          <li className="flex justify-between gap-4"><span className="text-muted">Brief recipient</span><span>{maskEmail(to)}</span></li>
        </ul>
        <p className="mt-3 text-sm text-muted">
          Times are set in <code>vercel.json</code>. On the Hobby plan Vercel starts a daily job at some point within the hour, so the brief lands between
          06:00 and 06:59 IST, well before 08:00. Email runs in Resend test mode, which delivers only to the account owner&apos;s address.
        </p>
      </Panel>
      <Panel title="Recent scheduled runs">
        {runs.length === 0 ? (
          <p className="text-muted">No scheduled run has happened yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium capitalize">{r.job}</p>
                  <p className="text-sm text-muted">
                    {formatDateTimeIST(r.startedAt)} IST · {timeAgo(r.startedAt)}
                    {r.finishedAt ? ` · took ${Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s` : ""}
                  </p>
                  {r.status === "error" && <p className="mt-1 text-sm text-bad">{String((r.detail as { error?: string } | null)?.error ?? "failed")}</p>}
                </div>
                <Badge tone={r.status === "ok" ? "good" : r.status === "error" ? "bad" : "neutral"}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
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
        <Suspense fallback={<PanelSkeleton className="h-72" />}>
          <Delivery />
        </Suspense>
      </div>
    </>
  );
}
