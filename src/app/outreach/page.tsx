import { Suspense } from "react";
import { connection } from "next/server";
import { Send } from "lucide-react";
import { EmptyState, PageHeader, Panel, PanelSkeleton } from "@/components/ui";
import { OutreachCard, SenderForm, type CardTarget } from "@/components/outreach-card";
import { getSender, listTargets } from "@/services/outreach";

export default function OutreachPage() {
  return (
    <>
      <PageHeader title="Outreach" subtitle="Who to contact and what to say. Drafts are written for you to review, edit, copy and approve. Nothing is ever sent from here." />
      <Suspense fallback={<PanelSkeleton className="h-96" />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const [targets, sender] = await Promise.all([listTargets(), getSender()]);
  const cards: CardTarget[] = targets.map((t) => ({
    kind: t.kind,
    id: t.id,
    name: t.name,
    company: t.company,
    score: t.score,
    level: t.level,
    reasons: t.reasons,
    contacts: t.contacts.map((c) => ({ id: c.id, kind: c.kind, value: c.value, sourceUrl: c.sourceUrl, verified: c.verified, note: c.note })),
    draft: t.draft ? { id: t.draft.id, status: t.draft.status, subject: t.draft.subject, body: t.draft.body, edited: t.draft.edited, warnings: t.draft.warnings as string[], approvedAt: t.draft.approvedAt ? t.draft.approvedAt.toISOString() : null } : null,
  }));
  return (
    <div className="grid gap-5">
      <Panel title="How outreach works here" icon={Send}>
        <ul className="grid gap-1.5 text-sm text-ink/90">
          <li>• Drafts use only facts from your own data (episodes, quotes). They contain no email address, phone number or link that was not supplied.</li>
          <li>• Contact routes are ones you add yourself. The system never guesses or looks up an address.</li>
          <li>• Sponsors appear only when a sponsorship was disclosed on a show. A promo link alone is not enough.</li>
          <li>• Sending is not built. When it is, each email will need your explicit go-ahead.</li>
        </ul>
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 text-sm font-medium">Signature used in drafts</p>
          <SenderForm name={sender.name} podcast={sender.podcast} />
        </div>
      </Panel>
      {cards.length ? cards.map((c) => <OutreachCard key={`${c.kind}-${c.id}`} t={c} />) : <EmptyState icon={Send} title="No one to contact yet"><p>Scores appear after the daily job.</p></EmptyState>}
    </div>
  );
}
