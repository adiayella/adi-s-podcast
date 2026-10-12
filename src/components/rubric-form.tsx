"use client";

import { useActionState } from "react";
import { saveRubricAction, type RubricState } from "@/app/rubrics/actions";

export function RubricForm({ kind, criteria }: { kind: "guest" | "sponsor"; criteria: { key: string; label: string; weight: number }[] }) {
  const [state, action, pending] = useActionState<RubricState, FormData>(saveRubricAction.bind(null, kind), null);
  const field = "w-20 rounded-lg bg-panel2 px-2.5 py-1.5 text-right tabular-nums ring-1 ring-line focus:outline-none focus:ring-accent";
  return (
    <form action={action} className="mt-4 grid gap-3 border-t border-line pt-4">
      <p className="text-sm font-medium">Edit weights (percent; they are rescaled to add up to 100%)</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {criteria.map((c) => (
          <label key={c.key} className="flex items-center justify-between gap-3 text-sm">
            <span>{c.label}</span>
            <input name={c.key} type="number" min={0} max={100} step={1} defaultValue={Math.round(c.weight * 100)} className={field} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input name="note" placeholder="Why this change? (optional)" maxLength={200} className="min-w-64 flex-1 rounded-lg bg-panel2 px-3 py-2 text-sm ring-1 ring-line focus:outline-none focus:ring-accent" />
        <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2 text-[15px] font-medium text-white hover:bg-accent/85 disabled:opacity-60">
          {pending ? "Saving…" : "Save as new version"}
        </button>
      </div>
      {state && (
        <p role="status" className={`text-sm ${state.ok ? "text-good" : "text-bad"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
