import { Suspense } from "react";
import { connection } from "next/server";
import { Mail } from "lucide-react";
import { Badge, EmptyState, PageHeader, PanelSkeleton } from "@/components/ui";
import { BriefActions } from "@/components/brief-actions";
import { BriefDeliveryForm } from "@/components/brief-delivery-form";
import { BriefView } from "@/components/brief-view";
import { isAdmin } from "@/lib/admin";
import { formatDateIST, formatDateTimeIST } from "@/lib/format";
import { buildBriefDoc } from "@/services/brief-render";
import { deliverySummary, type DeliveryStatus } from "@/services/delivery";
import { getDeliverySettings, latestReports, type StoredReport } from "@/services/brief";

export default function BriefPage({ searchParams }: PageProps<"/brief">) {
  return (
    <>
      <PageHeader title="Weekly Intelligence Brief" subtitle="Written every Monday morning (IST) about the week that just ended, saved here and emailed before recording." />
      <Suspense fallback={<PanelSkeleton className="h-96" />}>
        <Reports searchParams={searchParams} />
      </Suspense>
    </>
  );
}

type Tone = "good" | "bad" | "warn" | "neutral";
const genTone = (s: string): Tone => (s === "ready" ? "good" : s === "failed" ? "bad" : "warn");
const sendTone = (s: string): Tone => (s === "accepted" ? "good" : s === "failed" ? "bad" : s === "sending" ? "warn" : "neutral");
const delTone = (s: string): Tone => (s === "delivered" ? "good" : s === "bounced" || s === "failed" || s === "complained" ? "bad" : s === "delayed" ? "warn" : "neutral");

async function Reports({ searchParams }: { searchParams: PageProps<"/brief">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const [reports, admin, delivery] = await Promise.all([latestReports(12), isAdmin(), getDeliverySettings()]);
  const wanted = Array.isArray(sp.week) ? sp.week[0] : sp.week;
  const current = reports.find((r) => r.weekStart === wanted) ?? reports[0];

  if (!current) {
    return (
      <div className="grid gap-4">
        {admin && <BriefActions />}
        {admin && <BriefDeliveryForm recipient={delivery.recipient ?? ""} hourIST={delivery.hourIST} source={delivery.recipientSource} />}
        <EmptyState icon={Mail} title="No brief has been generated yet">
          <p>The first brief is created by the Monday job, or by an admin with “Generate now”. If the evidence is too thin to support a recommendation, the brief says so instead of inventing insights.</p>
        </EmptyState>
      </div>
    );
  }

  const ready = current.generationStatus === "ready";
  const stored = current.statsJson as StoredReport;
  const doc = ready ? buildBriefDoc(stored.stats, stored.narrative) : null;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2 text-sm text-muted">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={genTone(current.generationStatus)}>1 · Generation: {current.generationStatus}</Badge>
            <Badge tone={sendTone(current.sendStatus)}>2 · Hand-off to provider: {current.sendStatus.replace("_", " ")}</Badge>
            <Badge tone={delTone(current.deliveryStatus)}>3 · Delivery: {current.deliveryStatus}</Badge>
            {stored.meta?.narrativeError && <Badge tone="warn">AI commentary unavailable</Badge>}
          </div>
          <p>
            {current.generatedAt ? `Generated ${formatDateTimeIST(current.generatedAt)} IST` : "Not generated"}
            {current.emailedAt && ` · accepted by the email provider ${formatDateTimeIST(current.emailedAt)} IST`}
            {current.recipient && ` · to ${current.recipient}`}
            {current.sendAttempts > 0 && ` · ${current.sendAttempts} attempt${current.sendAttempts === 1 ? "" : "s"}`}
          </p>
          {current.sendStatus === "accepted" && (
            <p>
              {deliverySummary(current.deliveryStatus as DeliveryStatus, current.deliveryEvent)}
              {current.deliveryCheckedAt ? ` (checked ${formatDateTimeIST(current.deliveryCheckedAt)} IST)` : ""}
            </p>
          )}
          {current.generationError && <p className="text-bad">Generation error: {current.generationError}</p>}
          {current.sendError && <p className="text-bad">Send error: {current.sendError}</p>}
        </div>
        {admin && <BriefActions />}
      </div>

      {admin && <BriefDeliveryForm recipient={delivery.recipient ?? ""} hourIST={delivery.hourIST} source={delivery.recipientSource} />}

      {reports.length > 1 && (
        <nav aria-label="Previous briefs" className="flex flex-wrap gap-1.5">
          {reports.map((r) => (
            <a key={r.id} href={`/brief?week=${r.weekStart}`} aria-current={r.id === current.id ? "true" : undefined} className={`rounded-lg px-3 py-1.5 text-sm ring-1 ring-line ${r.id === current.id ? "bg-accent text-white" : "bg-panel text-muted hover:text-ink"}`}>
              Week of {formatDateIST(r.weekStart)}
              <span className="ml-1.5 text-xs opacity-80">{r.deliveryStatus === "delivered" ? "delivered" : r.sendStatus === "accepted" ? "sent" : r.generationStatus !== "ready" ? r.generationStatus : "draft"}</span>
            </a>
          ))}
        </nav>
      )}

      {doc ? <BriefView doc={doc} /> : <EmptyState icon={Mail} title={`This brief is ${current.generationStatus}`}><p>There is no content to show yet. Use “Generate now” or wait for the next scheduled run.</p></EmptyState>}
    </div>
  );
}
