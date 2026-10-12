import { Suspense } from "react";
import { connection } from "next/server";
import { Mail } from "lucide-react";
import { Badge, EmptyState, Panel, PanelSkeleton, PageHeader } from "@/components/ui";
import { getWeeklyReports } from "@/lib/queries";
import { formatDateIST } from "@/lib/format";

export default function BriefPage() {
  return (
    <>
      <PageHeader title="Weekly Intelligence Brief" subtitle="Generated every Monday morning (IST) and emailed before recording." />
      <Suspense fallback={<PanelSkeleton className="h-72" />}>
        <Reports />
      </Suspense>
    </>
  );
}

async function Reports() {
  await connection();
  const reports = await getWeeklyReports();
  if (!reports.length) {
    return (
      <EmptyState icon={Mail} title="No brief has been generated yet">
        <p>
          The first brief is created after the NLP analysis has run. If the evidence is too thin to support a
          recommendation, the brief will say so instead of inventing insights.
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-5">
      {reports.map((r) => (
        <Panel
          key={r.id}
          title={`Week of ${formatDateIST(r.weekStart)}`}
          icon={Mail}
          right={<Badge tone={r.emailStatus === "sent" ? "good" : r.emailStatus === "failed" ? "bad" : "neutral"}>Email {r.emailStatus}</Badge>}
        >
          <pre className="font-sans text-[15px] leading-relaxed whitespace-pre-wrap text-ink/90">{r.briefMarkdown}</pre>
        </Panel>
      ))}
    </div>
  );
}
