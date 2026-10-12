import { Suspense } from "react";
import { connection } from "next/server";
import { Mail } from "lucide-react";
import { Badge, EmptyState, PageHeader, PanelSkeleton } from "@/components/ui";
import { BriefActions } from "@/components/brief-actions";
import { BriefView } from "@/components/brief-view";
import { isAdmin } from "@/lib/admin";
import { formatDateIST, formatDateTimeIST } from "@/lib/format";
import { buildBriefDoc } from "@/services/brief-render";
import { latestReports, type StoredReport } from "@/services/brief";

export default function BriefPage({ searchParams }: PageProps<"/brief">) {
  return (
    <>
      <PageHeader title="Weekly Intelligence Brief" subtitle="Generated every Monday morning (IST) from the database, saved here and emailed before recording." />
      <Suspense fallback={<PanelSkeleton className="h-96" />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Reports({ searchParams }: { searchParams: PageProps<"/brief">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const [reports, admin] = await Promise.all([latestReports(12), isAdmin()]);
  const wanted = Array.isArray(sp.week) ? sp.week[0] : sp.week;
  const current = reports.find((r) => r.weekStart === wanted) ?? reports[0];

  if (!current) {
    return (
      <div className="grid gap-4">
        {admin && <BriefActions />}
        <EmptyState icon={Mail} title="No brief has been generated yet">
          <p>The first brief is created by the Monday job, or by an admin with “Generate now”. If the evidence is too thin to support a recommendation, the brief says so instead of inventing insights.</p>
        </EmptyState>
      </div>
    );
  }

  const stored = current.statsJson as StoredReport;
  const doc = buildBriefDoc(stored.stats, stored.narrative);
  const tone = current.emailStatus === "sent" ? "good" : current.emailStatus === "failed" ? "bad" : "neutral";
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-sm text-muted">
          <Badge tone={tone}>Email {current.emailStatus}</Badge>
          {current.emailedAt && <span>sent {formatDateTimeIST(current.emailedAt)} IST</span>}
          <span>· generated {formatDateTimeIST(current.createdAt)} IST</span>
          {stored.meta.narrativeError && <Badge tone="warn">AI commentary unavailable</Badge>}
          {stored.meta.emailError && <span className="text-bad">{stored.meta.emailError}</span>}
        </div>
        {admin && <BriefActions />}
      </div>

      {reports.length > 1 && (
        <nav aria-label="Previous briefs" className="flex flex-wrap gap-1.5">
          {reports.map((r) => (
            <a key={r.id} href={`/brief?week=${r.weekStart}`} aria-current={r.id === current.id ? "true" : undefined} className={`rounded-lg px-3 py-1.5 text-sm ring-1 ring-line ${r.id === current.id ? "bg-accent text-white" : "bg-panel text-muted hover:text-ink"}`}>
              Week of {formatDateIST(r.weekStart)}
            </a>
          ))}
        </nav>
      )}

      <BriefView doc={doc} />
    </div>
  );
}
