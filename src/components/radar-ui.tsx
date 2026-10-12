import Link from "next/link";
import type { ReactNode } from "react";
import type { ScoreResult } from "@/scoring/formulas";
import { formatDateIST } from "@/lib/format";

const LABELS: Record<string, string> = {
  distinctPodcasts: "Distinct podcasts",
  totalAppearances: "Total appearances",
  recency: "Recency",
  confidence: "Evidence confidence",
  growth: "Weekly growth",
  confirmedOccurrences: "Disclosed sponsorships",
};

/** Builds a link that changes one query parameter and keeps the others. */
export function withParam(base: string, current: Record<string, string | undefined>, key: string, value: string | null) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v && k !== key) p.set(k, v);
  if (value) p.set(key, value);
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

export function Tabs({ options, current, hrefFor, label }: { options: { value: string; label: string }[]; current: string; hrefFor: (v: string) => string; label: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 rounded-xl bg-panel p-1 ring-1 ring-line">
      {options.map((o) => (
        <Link
          key={o.value}
          href={hrefFor(o.value)}
          aria-current={o.value === current ? "true" : undefined}
          className={`rounded-lg px-3.5 py-1.5 text-sm transition-colors ${o.value === current ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

/** Score 0-100 with its formula visible: weights, normalised values and the raw counts behind them. */
export function ScoreCell({ result, raw }: { result: ScoreResult; raw?: ReactNode }) {
  return (
    <details className="group w-36">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums">{result.score.toFixed(1)}</span>
          <span className="text-xs text-muted group-open:hidden">how?</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-panel2">
          <div className="h-1.5 rounded-full bg-gradient-to-r from-accent to-accent2" style={{ width: `${result.score}%` }} />
        </div>
      </summary>
      <div className="mt-2 grid gap-1 rounded-lg bg-panel2 p-2.5 text-xs text-muted">
        {Object.entries(result.components).map(([k, c]) => (
          <div key={k} className="flex justify-between gap-2">
            <span>
              {Math.round(c.weight * 100)}% {LABELS[k] ?? k}
            </span>
            <span className="tabular-nums text-ink">{Math.round(c.value * 100)}</span>
          </div>
        ))}
        {raw && <div className="mt-1 border-t border-line pt-1.5">{raw}</div>}
      </div>
    </details>
  );
}

export function Pct({ value }: { value: number }) {
  return <span className="tabular-nums">{Math.round(value * 100)}%</span>;
}

export function Sparkline({ points, width = 96, height = 28 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="text-xs text-muted">—</span>;
  const max = Math.max(1, ...points);
  const step = width / (points.length - 1);
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} role="img" aria-label={`Weekly episode counts: ${points.join(", ")}`} className="text-soft">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(points.length - 1) * step} cy={height - 3 - (points[points.length - 1] / max) * (height - 6)} r={3} fill="#8b5cf6" />
    </svg>
  );
}

export function EpisodeLinks({ items, summary }: { items: { title: string; url: string | null; podcast: string; at: string; extra?: ReactNode }[]; summary: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-sm text-soft hover:underline">{summary}</summary>
      <ul className="mt-2 grid max-w-md gap-2 text-sm">
        {items.map((e, i) => (
          <li key={i} className="rounded-lg bg-panel2 p-2.5">
            {e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer" className="line-clamp-2 hover:text-soft hover:underline">
                {e.title}
              </a>
            ) : (
              <span className="line-clamp-2">{e.title}</span>
            )}
            <p className="mt-0.5 text-xs text-muted">
              {e.podcast} · {formatDateIST(e.at)}
            </p>
            {e.extra}
          </li>
        ))}
      </ul>
    </details>
  );
}
