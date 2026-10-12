import { Suspense } from "react";
import { connection } from "next/server";
import { Scale } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, PanelSkeleton } from "@/components/ui";
import { RubricForm } from "@/components/rubric-form";
import { isAdmin } from "@/lib/admin";
import { getActiveRubric, latestOpportunities } from "@/services/intelligence";

export default function RubricsPage() {
  return (
    <>
      <PageHeader title="Scoring Rubrics" subtitle="How guests and sponsors are ranked as opportunities. Every score shows its reasons; changing the weights makes a new version and never rewrites history." />
      <Suspense fallback={<PanelSkeleton className="h-96" />}>
        <Body />
      </Suspense>
    </>
  );
}

const LABELS: Record<string, Record<string, string>> = {
  guest: { reach: "Reach across shows", recency: "Recency", focus: "Fit with your focus", audiencePull: "Audience pull", confidence: "Evidence confidence" },
  sponsor: { disclosure: "Verified disclosure", recency: "Recency", reach: "Reach across shows", focus: "Fit with your focus", confidence: "Evidence confidence" },
};
const tone = (l: string) => (l === "high" ? "good" : l === "medium" ? "warn" : "neutral");

async function Body() {
  await connection();
  const admin = await isAdmin();
  const kinds = ["guest", "sponsor"] as const;
  const data = await Promise.all(kinds.map(async (k) => ({ kind: k, rubric: await getActiveRubric(k), top: await latestOpportunities(k, 6) })));
  return (
    <div className="grid gap-5">
      {data.map(({ kind, rubric, top }) => {
        const total = Object.values(rubric.weights).reduce((a, b) => a + b, 0) || 1;
        const criteria = Object.entries(rubric.weights).map(([key, w]) => ({ key, label: LABELS[kind][key] ?? key, weight: w / total }));
        return (
          <Panel key={kind} title={kind === "guest" ? "Guest opportunity rubric" : "Sponsor opportunity rubric"} icon={Scale} right={<span className="text-sm text-muted">version {rubric.id}{rubric.note ? ` · ${rubric.note}` : ""}</span>}>
            <div className="flex flex-wrap gap-2">
              {criteria.map((c) => (
                <span key={c.key} className="rounded-lg bg-panel2 px-3 py-1.5 text-sm ring-1 ring-line">
                  {c.label} <strong className="tabular-nums">{Math.round(c.weight * 100)}%</strong>
                </span>
              ))}
            </div>
            {top.length ? (
              <ul className="mt-5 grid gap-3">
                {top.map((o) => (
                  <li key={o.entity_id} className="rounded-xl bg-panel2 p-4 ring-1 ring-line">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">
                        {o.name}
                        {o.company ? <span className="font-normal text-muted"> · {o.company}</span> : null}
                      </p>
                      <div className="flex items-center gap-2">
                        <Badge tone={tone(o.confidence.level)}>evidence {o.confidence.level}</Badge>
                        <span className="text-xl font-semibold tabular-nums">{Number(o.score).toFixed(1)}</span>
                      </div>
                    </div>
                    <ul className="mt-3 grid gap-1.5">
                      {o.criteria.map((c) => (
                        <li key={c.key} className="grid grid-cols-[150px_1fr] items-center gap-3 text-sm">
                          <span className="text-muted">{c.label}</span>
                          <span className="flex items-center gap-3">
                            <span className="h-2 w-28 shrink-0 overflow-hidden rounded-full bg-line">
                              <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((c.value ?? 0) * 100)}%` }} />
                            </span>
                            <span className="text-ink/80">
                              {c.value === null ? "no data, left out" : `${Math.round(c.value * 100)}% × weight ${Math.round(c.weight * 100)}%`} · {c.note}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4">
                <EmptyState icon={Scale} title="Nothing scored yet">
                  <p>Scores are calculated by the daily job.</p>
                </EmptyState>
              </div>
            )}
            {admin ? <RubricForm kind={kind} criteria={criteria} /> : <p className="mt-4 text-sm text-muted">Sign in as admin to edit weights.</p>}
          </Panel>
        );
      })}
    </div>
  );
}
