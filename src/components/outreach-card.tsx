"use client";

import { useActionState, useState } from "react";
import { Check, Copy, RefreshCw, Trash2, X } from "lucide-react";
import { addContactAction, approveDraftAction, deleteContactAction, generateDraftAction, rejectDraftAction, saveDraftAction, saveSenderAction, type OutreachState } from "@/app/outreach/actions";
import { Badge } from "@/components/ui";
import { safeHref } from "@/nlp/outreach";

type Contact = { id: number; kind: string; value: string; sourceUrl: string | null; verified: boolean; note: string | null };
type Draft = { id: number; status: string; subject: string; body: string; edited: boolean; warnings: string[]; approvedAt: string | null };
export type CardTarget = { kind: "guest" | "brand"; id: number; name: string; company: string | null; score: number; level: string; reasons: string[]; contacts: Contact[]; draft: Draft | null };

const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-60";
const field = "rounded-lg bg-panel px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-accent";

function Msg({ s }: { s: OutreachState }) {
  return s ? (
    <p role="status" className={`text-sm ${s.ok ? "text-good" : "text-bad"}`}>
      {s.message}
    </p>
  ) : null;
}

export function SenderForm({ name, podcast }: { name: string; podcast: string }) {
  const [s, action, pending] = useActionState<OutreachState, FormData>(saveSenderAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm text-muted">
        Your name
        <input name="name" defaultValue={name} className={field} required />
      </label>
      <label className="grid gap-1 text-sm text-muted">
        Your podcast
        <input name="podcast" defaultValue={podcast} className={field} required />
      </label>
      <button disabled={pending} className={`${btn} bg-accent text-white hover:bg-accent/85`}>
        {pending ? "Saving…" : "Save"}
      </button>
      <Msg s={s} />
    </form>
  );
}

export function OutreachCard({ t }: { t: CardTarget }) {
  const [gen, genAction, genPending] = useActionState<OutreachState, FormData>(generateDraftAction, null);
  const [save, saveAction, savePending] = useActionState<OutreachState, FormData>(saveDraftAction, null);
  const [appr, apprAction, apprPending] = useActionState<OutreachState, FormData>(approveDraftAction, null);
  const [rej, rejAction] = useActionState<OutreachState, FormData>(rejectDraftAction, null);
  const [contact, contactAction, contactPending] = useActionState<OutreachState, FormData>(addContactAction, null);
  const [, delAction] = useActionState<OutreachState, FormData>(deleteContactAction, null);
  const [copied, setCopied] = useState(false);
  const d = t.draft;
  const tone = d?.status === "approved" ? "good" : d?.status === "rejected" ? "bad" : "warn";

  async function copy() {
    if (!d) return;
    const form = document.getElementById(`draft-${d.id}`) as HTMLFormElement | null;
    const subject = (form?.elements.namedItem("subject") as HTMLInputElement | null)?.value ?? d.subject;
    const body = (form?.elements.namedItem("body") as HTMLTextAreaElement | null)?.value ?? d.body;
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="rounded-2xl bg-panel p-5 ring-1 ring-line">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            {t.name} {t.company && t.kind === "guest" && <span className="text-base font-normal text-muted">· {t.company}</span>}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge>{t.kind === "guest" ? "Guest" : "Sponsor (verified disclosure)"}</Badge>
            <Badge tone={t.level === "high" ? "good" : t.level === "medium" ? "warn" : "neutral"}>evidence {t.level}</Badge>
            <span>opportunity score {t.score.toFixed(0)}</span>
          </p>
        </div>
      </header>
      {t.reasons.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-ink/85">{t.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}

      <section className="mt-4">
        <p className="text-sm font-medium">Contact routes you saved</p>
        {t.contacts.length ? (
          <ul className="mt-1.5 grid gap-1.5 text-sm">
            {t.contacts.map((c) => {
              const href = c.kind === "email" ? null : safeHref(c.value);
              const src = safeHref(c.sourceUrl);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <Badge>{c.kind}</Badge>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2">
                      {c.value}
                    </a>
                  ) : (
                    <span>{c.value}</span>
                  )}
                  {c.verified ? <Badge tone="good">you verified</Badge> : <Badge tone="warn">unverified</Badge>}
                  {src && (
                    <a href={src} target="_blank" rel="noreferrer" className="text-muted underline">
                      source
                    </a>
                  )}
                  {c.note && <span className="text-muted">{c.note}</span>}
                  <form action={delAction}>
                    <input type="hidden" name="contactId" value={c.id} />
                    <button aria-label="Remove contact" className="text-muted hover:text-bad">
                      <Trash2 size={14} />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">None yet. The system never guesses an address; add one you found yourself.</p>
        )}
        <form action={contactAction} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="kind" value={t.kind} />
          <input type="hidden" name="id" value={t.id} />
          <select name="type" className={field} defaultValue="linkedin" aria-label="Contact type">
            <option value="linkedin">LinkedIn</option>
            <option value="email">Email</option>
            <option value="website">Website</option>
            <option value="x">X / Twitter</option>
            <option value="other">Other</option>
          </select>
          <input name="value" placeholder="Address or link" className={`${field} w-56`} required />
          <input name="sourceUrl" placeholder="Where you found it (link)" className={`${field} w-56`} />
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" name="verified" /> I verified it
          </label>
          <button disabled={contactPending} className={`${btn} bg-panel2 ring-1 ring-line hover:ring-accent/60`}>
            Add
          </button>
          <Msg s={contact} />
        </form>
      </section>

      <section className="mt-5 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            Email draft {d && <Badge tone={tone}>{d.status}{d.edited && d.status === "draft" ? " · edited" : ""}</Badge>}
          </p>
          <form action={genAction}>
            <input type="hidden" name="kind" value={t.kind} />
            <input type="hidden" name="id" value={t.id} />
            <button disabled={genPending} className={`${btn} bg-panel2 ring-1 ring-line hover:ring-accent/60`}>
              <RefreshCw size={14} /> {genPending ? "Writing…" : d ? "Regenerate" : "Write a draft"}
            </button>
          </form>
        </div>
        <Msg s={gen} />
        {d ? (
          <form id={`draft-${d.id}`} action={saveAction} className="mt-3 grid gap-2">
            <input type="hidden" name="draftId" value={d.id} />
            <input name="subject" defaultValue={d.subject} className={`${field} w-full`} aria-label="Subject" />
            <textarea name="body" defaultValue={d.body} rows={9} className={`${field} w-full leading-relaxed`} aria-label="Email body" />
            {d.warnings.length > 0 && (
              <ul className="text-sm text-warn">
                {d.warnings.map((w) => (
                  <li key={w}>⚠ {w}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={savePending} className={`${btn} bg-panel2 ring-1 ring-line hover:ring-accent/60`}>
                {savePending ? "Saving…" : "Save edits"}
              </button>
              <button type="button" onClick={copy} className={`${btn} bg-panel2 ring-1 ring-line hover:ring-accent/60`}>
                <Copy size={14} /> {copied ? "Copied" : "Copy"}
              </button>
              <button formAction={apprAction} disabled={apprPending || d.status === "approved"} className={`${btn} bg-good/20 text-good hover:bg-good/30`}>
                <Check size={14} /> {d.status === "approved" ? "Approved" : "Approve"}
              </button>
              <button formAction={rejAction} className={`${btn} text-muted hover:text-bad`}>
                <X size={14} /> Reject
              </button>
            </div>
            <Msg s={save ?? appr ?? rej} />
            <p className="text-xs text-muted">Approval records your sign-off only. Nothing is sent from this app: copy the text and send it yourself. Save your edits before approving.</p>
          </form>
        ) : (
          <p className="mt-2 text-sm text-muted">No draft yet.</p>
        )}
      </section>
    </article>
  );
}
