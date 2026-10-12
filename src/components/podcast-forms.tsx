"use client";

import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { addPodcast, deletePodcast, type ActionState } from "@/app/podcasts/actions";

const inputCls =
  "w-full rounded-xl bg-panel2 px-3.5 py-2.5 text-[15px] text-ink ring-1 ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-accent focus:outline-none";

export function AddPodcastForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addPodcast, null);
  return (
    <form
      action={action}
      className="grid gap-3 md:grid-cols-[1.2fr_2fr_1.4fr_auto]"
    >
      <label className="grid gap-1.5 text-sm text-muted">
        Podcast name
        <input name="name" required placeholder="e.g. The Neon Show" className={inputCls} />
      </label>
      <label className="grid gap-1.5 text-sm text-muted">
        RSS feed URL
        <input name="rssUrl" type="url" placeholder="https://feeds.example.com/show.rss" className={inputCls} />
      </label>
      <label className="grid gap-1.5 text-sm text-muted">
        YouTube channel ID (optional)
        <input name="youtubeChannelId" placeholder="UC…" className={inputCls} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-auto inline-flex h-[44px] items-center justify-center gap-2 rounded-xl bg-accent px-5 font-medium text-white transition hover:bg-accent/85 disabled:opacity-60"
      >
        <Plus size={18} /> {pending ? "Adding…" : "Add"}
      </button>
      {state && (
        <p role="status" className={`md:col-span-4 text-sm ${state.ok ? "text-good" : "text-bad"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}

export function DeleteButton({ id, name }: { id: number; name: string }) {
  return (
    <form
      action={deletePodcast}
      onSubmit={(e) => {
        if (!confirm(`Remove “${name}” and all of its stored episodes? This cannot be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={`Remove ${name}`}
        className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-bad/15 hover:text-bad"
      >
        <Trash2 size={17} />
      </button>
    </form>
  );
}
