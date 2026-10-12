"use client";

import { useActionState } from "react";
import { saveDelivery, type BriefActionState } from "@/app/brief/actions";

export function BriefDeliveryForm({ recipient, hourIST, source }: { recipient: string; hourIST: number; source: string }) {
  const [state, action, pending] = useActionState<BriefActionState, FormData>(saveDelivery, null);
  const field = "rounded-lg bg-panel2 px-3 py-2 text-[15px] ring-1 ring-line focus:outline-none focus:ring-accent";
  return (
    <form action={action} className="grid gap-3 rounded-xl bg-panel p-4 ring-1 ring-line">
      <p className="text-sm font-medium">Delivery settings</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm text-muted">
          Send the Monday brief to
          <input name="recipient" type="email" required defaultValue={recipient} className={`${field} w-72`} />
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Preferred hour (IST)
          <select name="hourIST" defaultValue={hourIST} className={field}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className="rounded-xl bg-accent px-4 py-2.5 text-[15px] font-medium text-white hover:bg-accent/85 disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        {state && (
          <p role="status" className={`text-sm ${state.ok ? "text-good" : "text-bad"}`}>
            {state.message}
          </p>
        )}
      </div>
      <p className="text-xs text-muted">
        Recipient is currently read from {source}. The preferred hour is stored, but the schedule itself lives in vercel.json (Monday 07:00 IST; the free Vercel plan allows one run per day and may start it up to an hour late). A different hour takes effect once the cron line is changed to match.
      </p>
    </form>
  );
}
