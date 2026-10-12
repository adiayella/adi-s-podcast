"use client";

import { useState } from "react";
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EngagementData, EvidenceItem, SectorSeries } from "@/services/overview";

const COLORS = ["#3b82f6", "#f59e0b", "#8b5cf6", "#22d3ee", "#7ee2a8"];
const tip = { background: "#1b2646", border: "1px solid rgba(160,174,220,0.18)", borderRadius: 10, color: "#e9edf9", fontSize: 13 };
const axis = { fill: "#8f9bbd", fontSize: 11 };
const compact = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(0)}K` : String(x));

export function SectorExplorer({ data }: { data: SectorSeries }) {
  const [metric, setMetric] = useState<"episodes" | "views">("episodes");
  const rows = data.weeks.map((w, i) => ({ week: w, ...Object.fromEntries(data.topics.map((t) => [t.name, t[metric][i]])) }));
  if (!data.topics.length) return <p className="py-10 text-center text-muted">No topic data yet.</p>;
  return (
    <div>
      <div className="mb-3 flex gap-2" role="tablist" aria-label="Metric">
        {(["episodes", "views"] as const).map((m) => (
          <button key={m} role="tab" aria-selected={metric === m} onClick={() => setMetric(m)} className={`rounded-lg px-3.5 py-1.5 text-sm ${metric === m ? "bg-accent text-white" : "bg-panel2 text-muted ring-1 ring-line hover:text-ink"}`}>
            {m === "episodes" ? "Episodes" : "Views"}
          </button>
        ))}
      </div>
      <div className="h-64 w-full" role="img" aria-label={`Weekly ${metric} by topic`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="rgba(160,174,220,0.1)" vertical={false} />
            <XAxis dataKey="week" tick={axis} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={metric === "views" ? compact : undefined} />
            <Tooltip contentStyle={tip} formatter={(v) => (metric === "views" ? Number(v).toLocaleString("en-IN") : v)} />
            <Legend wrapperStyle={{ fontSize: 12, color: "#8f9bbd" }} />
            {data.topics.map((t, i) => (
              <Area key={t.name} type="monotone" dataKey={t.name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.14} strokeWidth={2} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function EngagementChart({ data }: { data: EngagementData }) {
  if (!data.weekly.length) return <p className="py-10 text-center text-muted">No YouTube counts stored yet.</p>;
  return (
    <div className="h-56 w-full" role="img" aria-label="Views, likes and comments by publish week">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data.weekly} margin={{ top: 8, right: 0, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="rgba(160,174,220,0.1)" vertical={false} />
          <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
          <YAxis yAxisId="v" tick={axis} axisLine={false} tickLine={false} tickFormatter={compact} />
          <YAxis yAxisId="e" orientation="right" tick={axis} axisLine={false} tickLine={false} tickFormatter={compact} />
          <Tooltip contentStyle={tip} formatter={(v) => Number(v).toLocaleString("en-IN")} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#8f9bbd" }} />
          <Bar yAxisId="v" dataKey="views" name="Views" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line yAxisId="e" type="monotone" dataKey="likes" name="Likes" stroke="#f59e0b" strokeWidth={2} dot={false} />
          <Line yAxisId="e" type="monotone" dataKey="comments" name="Comments" stroke="#a78bfa" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const LEVEL: Record<string, string> = { high: "bg-good/15 text-good", medium: "bg-warn/15 text-warn", low: "bg-panel2 text-muted" };

export function EvidenceTabs({ insights, quotes }: { insights: EvidenceItem[]; quotes: EvidenceItem[] }) {
  const [tab, setTab] = useState<"insights" | "quotes">("insights");
  const list = tab === "insights" ? insights : quotes;
  return (
    <div>
      <div className="mb-3 flex gap-2" role="tablist">
        {([["insights", `Key insights (${insights.length})`], ["quotes", `Notable quotes (${quotes.length})`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === k ? "bg-accent text-white" : "bg-panel2 text-muted ring-1 ring-line hover:text-ink"}`}>
            {l}
          </button>
        ))}
      </div>
      <ul className="grid gap-3">
        {list.map((e) => (
          <li key={e.title + e.source} className="rounded-xl bg-panel2 p-3.5 ring-1 ring-line">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[15px] font-medium leading-snug">{e.title}</p>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase ${LEVEL[e.level]}`}>{e.level}</span>
            </div>
            <p className="mt-1.5 text-sm text-ink/85">{e.line}</p>
            {e.source && (
              <p className="mt-1.5 truncate text-xs text-muted">
                {e.url && /^https?:\/\//.test(e.url) ? (
                  <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
                    {e.source}
                  </a>
                ) : (
                  e.source
                )}
              </p>
            )}
          </li>
        ))}
        {!list.length && <li className="text-sm text-muted">Nothing to show yet.</li>}
      </ul>
    </div>
  );
}
