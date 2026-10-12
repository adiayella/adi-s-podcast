"use client";

import { useActionState, useState } from "react";
import { Check, X } from "lucide-react";
import { restoreSettings, reviewCandidate, runDiscoveryNow, runFocusedNow, savePreferences, type FormState } from "@/app/research/actions";
import { FREQUENCIES, LANGUAGES, MARKETS, type ResearchConfig } from "@/research/config";
import { TOPICS } from "@/nlp/taxonomy";

const field = "w-full rounded-xl bg-panel2 px-3.5 py-2.5 text-[15px] text-ink ring-1 ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-accent focus:outline-none disabled:opacity-60";

function Msg({ s }: { s: FormState }) {
  if (!s) return null;
  return (
    <p role="status" className={`text-sm ${s.ok ? "text-good" : "text-bad"}`}>
      {s.message}
    </p>
  );
}

/** Toggle chips that submit as repeated form fields (name=value). */
function Chips({ name, options, selected, disabled }: { name: string; options: { value: string; label: string }[]; selected: string[]; disabled?: boolean }) {
  const [on, setOn] = useState(new Set(selected));
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = on.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => setOn((p) => { const n = new Set(p); if (n.has(o.value)) n.delete(o.value); else n.add(o.value); return n; })}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ring-1 transition disabled:opacity-60 ${active ? "bg-accent/25 text-ink ring-accent/60" : "bg-panel2 text-muted ring-line hover:text-ink"}`}
          >
            {active && <Check size={13} />}
            {o.label}
          </button>
        );
      })}
      {[...on].map((v) => <input key={v} type="hidden" name={name} value={v} />)}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-2.5">
      <legend className="text-[15px] font-semibold">{title}</legend>
      {hint && <p className="-mt-1 text-sm text-muted">{hint}</p>}
      {children}
    </fieldset>
  );
}

/**
 * The form and its result message live here and never remount. The fields inside are keyed on the saved
 * version, so they reset to the newly saved values without wiping the "Saved as version N" confirmation.
 */
export function PreferencesForm({ config, version, podcasts, canEdit }: { config: ResearchConfig; version: number; podcasts: { id: number; name: string }[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePreferences, null);
  return (
    <form action={action} className="grid gap-7">
      <PreferenceFields key={version} config={config} version={version} podcasts={podcasts} canEdit={canEdit} pending={pending} />
      <Msg s={state} />
    </form>
  );
}

function PreferenceFields({ config, version, podcasts, canEdit, pending }: { config: ResearchConfig; version: number; podcasts: { id: number; name: string }[]; canEdit: boolean; pending: boolean }) {
  const [discovery, setDiscovery] = useState(config.effort.discovery);
  const topicOpts = TOPICS.map((t) => ({ value: t, label: t }));
  const d = !canEdit;
  const terms = (xs: string[]) => xs.join(", ");
  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Research modes" hint="Switch either mode off without losing its settings.">
          <label className="flex items-center gap-2.5 text-[15px]"><input type="checkbox" name="focusedEnabled" defaultChecked={config.modes.focused.enabled} disabled={d} className="size-4 accent-[#5b6cf0]" /> Focused Research (monitor my watchlist)</label>
          <label className="flex items-center gap-2.5 text-[15px]"><input type="checkbox" name="discoveryEnabled" defaultChecked={config.modes.discovery.enabled} disabled={d} className="size-4 accent-[#5b6cf0]" /> Discovery Research (find new podcasts)</label>
        </Section>
        <Section title="Research effort" hint="How effort and the YouTube budget are shared between the two modes.">
          <input type="range" name="discoveryEffort" min={0} max={100} step={5} value={discovery} onChange={(e) => setDiscovery(Number(e.target.value))} disabled={d} className="w-full accent-[#5b6cf0]" aria-label="Share of research effort for discovery" />
          <div className="flex justify-between text-sm"><span>Focused <b>{100 - discovery}%</b></span><span>Discovery <b>{discovery}%</b></span></div>
        </Section>
      </div>

      <Section title="Preferred categories" hint="Topics you want prioritised. Anything else from your shows can still surface as an unexpected trend.">
        <Chips name="categories" options={topicOpts} selected={config.categories} disabled={d} />
      </Section>
      <Section title="Priority topics" hint="Shown first and used to rank discovered podcasts.">
        <Chips name="priorityTopics" options={topicOpts} selected={config.priorityTopics} disabled={d} />
      </Section>
      <Section title="Excluded topics" hint="Episodes about only these topics are left out of the radars and brief.">
        <Chips name="excludedTopics" options={topicOpts} selected={config.excludedTopics} disabled={d} />
      </Section>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm text-muted">Keywords and topics of interest<textarea name="keywords" rows={3} defaultValue={terms(config.keywords)} disabled={d} placeholder="AI agents, Indian startup ecosystem" className={field} /></label>
        <label className="grid gap-1.5 text-sm text-muted">Founders<textarea name="founders" rows={3} defaultValue={terms(config.founders)} disabled={d} placeholder="Nikhil Kamath, Aadit Palicha" className={field} /></label>
        <label className="grid gap-1.5 text-sm text-muted">Companies<textarea name="companies" rows={3} defaultValue={terms(config.companies)} disabled={d} placeholder="Zepto, Razorpay" className={field} /></label>
        <label className="grid gap-1.5 text-sm text-muted">Products<textarea name="products" rows={3} defaultValue={terms(config.products)} disabled={d} placeholder="UPI, quick commerce" className={field} /></label>
        <label className="grid gap-1.5 text-sm text-muted md:col-span-2">Excluded keywords (episodes mentioning these are ignored)<textarea name="excludedKeywords" rows={2} defaultValue={terms(config.excludedKeywords)} disabled={d} placeholder="cricket, astrology" className={field} /></label>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Section title="Languages"><Chips name="languages" options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} selected={config.languages} disabled={d} /></Section>
        <Section title="Geographic markets"><Chips name="markets" options={MARKETS.map((m) => ({ value: m.code, label: m.label }))} selected={config.markets} disabled={d} /></Section>
      </div>

      <Section title="Priority podcasts" hint="Collected first on every run, and counted as a match for your focus.">
        <Chips name="priorityPodcastIds" options={podcasts.map((p) => ({ value: String(p.id), label: p.name }))} selected={config.priorityPodcastIds.map(String)} disabled={d} />
      </Section>

      <div className="grid gap-5 md:grid-cols-4">
        <label className="grid gap-1.5 text-sm text-muted">Research date range
          <select name="dateRangeDays" defaultValue={config.dateRangeDays} disabled={d} className={field}>{[30, 60, 90, 180, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select>
        </label>
        <label className="grid gap-1.5 text-sm text-muted">Monitor watchlist
          <select name="freqFocused" defaultValue={config.frequency.focused} disabled={d} className={field}>{FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
        </label>
        <label className="grid gap-1.5 text-sm text-muted">Run discovery
          <select name="freqDiscovery" defaultValue={config.frequency.discovery} disabled={d} className={field}>{FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
        </label>
        <label className="grid gap-1.5 text-sm text-muted">YouTube units per day
          <input name="quotaBudgetUnits" type="number" min={0} max={8000} step={100} defaultValue={config.quotaBudgetUnits} disabled={d} className={field} />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="grid min-w-64 flex-1 gap-1.5 text-sm text-muted">Note for this version (optional)<input name="note" maxLength={140} disabled={d} placeholder="e.g. Added AI agents" className={field} /></label>
        <button type="submit" disabled={d || pending} className="rounded-xl bg-accent px-6 py-2.5 font-medium text-white transition hover:bg-accent/85 disabled:opacity-60">{pending ? "Saving…" : "Save preferences"}</button>
        <span className="pb-2.5 text-sm text-muted">Editing version {version}; saving creates a new version.</span>
      </div>
    </>
  );
}

export function RunButton({ label, mode }: { label: string; mode: "focused" | "discovery" }) {
  const [state, action, pending] = useActionState<FormState>(mode === "focused" ? runFocusedNow : runDiscoveryNow, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className="rounded-xl bg-panel2 px-4 py-2.5 text-[15px] font-medium ring-1 ring-line transition hover:ring-accent/60 disabled:opacity-60">{pending ? "Running… this can take a few minutes" : label}</button>
      <Msg s={state} />
    </form>
  );
}

/** Approve, save for later, dismiss or exclude a discovered podcast. */
export function ReviewButtons({ id, status, canApprove, noFeedReason }: { id: number; status: string; canApprove: boolean; noFeedReason?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reviewCandidate, null);
  const btn = "rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition disabled:opacity-50";
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        <button name="action" value="approve" disabled={pending || !canApprove} title={canApprove ? "Add to my watchlist" : noFeedReason} className={`${btn} bg-accent text-white ring-accent hover:bg-accent/85`}>Approve and add</button>
        {status !== "saved" && <button name="action" value="saved" disabled={pending} className={`${btn} bg-panel2 ring-line hover:ring-accent/60`}>Save for later</button>}
        {status === "saved" && <button name="action" value="new" disabled={pending} className={`${btn} bg-panel2 ring-line hover:ring-accent/60`}>Back to review</button>}
        <button name="action" value="dismiss" disabled={pending} className={`${btn} bg-panel2 ring-line hover:ring-bad/60`}><X size={13} className="mr-1 inline" />Dismiss</button>
        <button name="action" value="excluded" disabled={pending} title="Never suggest this source again" className={`${btn} bg-panel2 text-muted ring-line hover:ring-bad/60`}>Exclude source</button>
      </div>
      {!canApprove && <p className="text-xs text-muted">{noFeedReason}</p>}
      <Msg s={state} />
    </form>
  );
}

export function RestoreButton({ version }: { version: number }) {
  return (
    <form action={restoreSettings}>
      <input type="hidden" name="version" value={version} />
      <button type="submit" className="text-sm text-soft hover:underline">Restore</button>
    </form>
  );
}
