import { Suspense } from "react";
import { connection } from "next/server";
import { MessageCircleQuestion } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, PanelSkeleton } from "@/components/ui";
import { formatDateTimeIST } from "@/lib/format";
import { audienceStats, topAudienceThemes } from "@/services/audience";

export default function AudiencePage() {
  return (
    <>
      <PageHeader title="Audience Questions" subtitle="What viewers ask, worry about and request in public YouTube comments, from a bounded sample of each recent episode." />
      <Suspense fallback={<PanelSkeleton className="h-96" />}>
        <Body />
      </Suspense>
    </>
  );
}

const KIND: Record<string, string> = { question: "Questions viewers ask", concern: "Recurring concerns", topic_request: "Topics and guests requested" };

async function Body() {
  await connection();
  const [themes, stats] = await Promise.all([topAudienceThemes(60), audienceStats()]);
  if (!themes.length)
    return (
      <EmptyState icon={MessageCircleQuestion} title="No audience findings yet">
        <p>They appear after the daily job reads comments on recent episodes that have enough discussion.</p>
      </EmptyState>
    );
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted">
        Based on {stats.videos} videos and {stats.sample.toLocaleString("en-IN")} sampled comments (at most 100 per video, YouTube’s top comments), last updated {stats.last ? formatDateTimeIST(stats.last) : "never"} IST. This is a sample of the loudest comments, not the whole audience.
      </p>
      {(["question", "concern", "topic_request"] as const).map((kind) => {
        const list = themes.filter((t) => t.kind === kind).slice(0, 8);
        if (!list.length) return null;
        return (
          <Panel key={kind} title={KIND[kind]}>
            <ul className="grid gap-4">
              {list.map((t) => (
                <li key={t.id} className="rounded-xl bg-panel2 p-4 ring-1 ring-line">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="good">Observed</Badge>
                    <span className="text-sm tabular-nums">
                      {t.support} comment{t.support === 1 ? "" : "s"} across {t.videos} video{t.videos === 1 ? "" : "s"} · {(t.podcasts as string[]).join(", ")}
                    </span>
                  </div>
                  <ul className="mt-2 grid gap-1 text-sm text-ink/90">
                    {(t.quotes as string[]).map((q) => (
                      <li key={q}>“{q}”</li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-line pt-3">
                    <Badge tone="warn">AI interpretation</Badge>
                    <div className="text-sm">
                      <p>{t.label}</p>
                      {(t.interviewQuestions as string[]).map((q) => (
                        <p key={q} className="mt-1 text-muted">
                          Suggested interview question: {q}
                        </p>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
      <p className="text-sm text-muted">“Observed” is counted by code from the comments themselves, with verbatim excerpts (handles and links removed). “AI interpretation” is Gemini’s name for the group and its suggested interview questions; check them against the quotes. Raw comments are not stored.</p>
    </div>
  );
}
