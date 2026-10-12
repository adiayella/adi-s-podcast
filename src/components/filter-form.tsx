"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Podcast filter (and optional journalist toggle) that updates the URL as soon as it changes. */
export function FilterForm({
  basePath,
  params,
  podcasts,
  podcast,
  journalists,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  podcasts: { id: number; name: string }[];
  podcast?: string;
  journalists?: boolean | null; // null = hide the toggle
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go(next: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...next })) if (v) p.set(k, v);
    const qs = p.toString();
    start(() => router.push(qs ? `${basePath}?${qs}` : basePath));
  }

  const cls = "rounded-xl bg-panel px-3 py-2 text-sm text-ink ring-1 ring-line focus:ring-2 focus:ring-accent focus:outline-none";
  return (
    <div className={`flex flex-wrap items-center gap-3 ${pending ? "opacity-70" : ""}`}>
      <label className="sr-only" htmlFor="podcast-filter">
        Filter by podcast
      </label>
      <select id="podcast-filter" className={cls} value={podcast ?? ""} onChange={(e) => go({ podcast: e.target.value || undefined })}>
        <option value="">All monitored podcasts</option>
        {podcasts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {journalists !== null && journalists !== undefined && (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={journalists} onChange={(e) => go({ journalists: e.target.checked ? "1" : undefined })} className="size-4 accent-[#5b6cf0]" />
          Include journalists
        </label>
      )}
    </div>
  );
}
