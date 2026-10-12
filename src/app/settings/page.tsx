import { connection } from "next/server";
import { Suspense } from "react";
import { Check, Database, Mail, Sparkles, Video, X, Rss } from "lucide-react";
import { Panel, PanelSkeleton, PageHeader } from "@/components/ui";

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

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Data Sources" subtitle="Where the data comes from and which integrations are connected." />
      <Suspense fallback={<PanelSkeleton className="h-96" />}>
        <Sources />
      </Suspense>
    </>
  );
}
