"use client";

import { useActionState } from "react";
import { Mail, RefreshCw, Sparkles } from "lucide-react";
import { checkDeliveryNow, generateNow, sendNow, type BriefActionState } from "@/app/brief/actions";

export function BriefActions() {
  const [gen, genAction, genPending] = useActionState<BriefActionState>(generateNow, null);
  const [send, sendAction, sendPending] = useActionState<BriefActionState>(sendNow, null);
  const btn = "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[15px] font-medium transition disabled:opacity-60";
  const [check, checkAction, checkPending] = useActionState<BriefActionState>(checkDeliveryNow, null);
  const msg = check ?? send ?? gen;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={genAction}>
        <button type="submit" disabled={genPending} className={`${btn} bg-accent text-white hover:bg-accent/85`}>
          <Sparkles size={17} /> {genPending ? "Generating…" : "Generate now"}
        </button>
      </form>
      <form action={sendAction}>
        <button type="submit" disabled={sendPending} className={`${btn} bg-panel2 ring-1 ring-line hover:ring-accent/60`}>
          <Mail size={17} /> {sendPending ? "Sending…" : "Email this brief"}
        </button>
      </form>
      <form action={checkAction}>
        <button type="submit" disabled={checkPending} className={`${btn} bg-panel2 ring-1 ring-line hover:ring-accent/60`}>
          <RefreshCw size={17} /> {checkPending ? "Checking…" : "Check delivery"}
        </button>
      </form>
      {msg && (
        <p role="status" className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>
          {msg.message}
        </p>
      )}
    </div>
  );
}
