"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const PALETTE = ["#5b6cf0", "#8b5cf6", "#a5aef5", "#38bdf8", "#7ee2a8", "#f6c667", "#64748b"];

const tooltipStyle = {
  background: "#1b2646",
  border: "1px solid rgba(160,174,220,0.18)",
  borderRadius: 10,
  color: "#e9edf9",
  fontSize: 13,
};

export function WeeklyEpisodesChart({ data }: { data: { label: string; episodes: number }[] }) {
  const last = data.length - 1;
  return (
    <div className="h-72 w-full" role="img" aria-label="Episodes published per week">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="rgba(160,174,220,0.1)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#8f9bbd", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#8f9bbd", fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "rgba(91,108,240,0.12)" }}
            contentStyle={tooltipStyle}
            formatter={(v) => [v, "Episodes"]}
            labelFormatter={(l) => `Week of ${l}`}
          />
          <Bar dataKey="episodes" radius={[6, 6, 0, 0]} maxBarSize={34}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === last ? "#8b5cf6" : "#5b6cf0"} fillOpacity={i === last ? 1 : 0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ShareDonut({ data, total }: { data: { name: string; value: number }[]; total: number }) {
  return (
    <div>
      <div className="relative mx-auto h-56 w-56" role="img" aria-label="Share of episodes by show">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={68} outerRadius={104} paddingAngle={2} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [v, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-3xl font-semibold tabular-nums">{total}</p>
            <p className="text-xs text-muted">episodes</p>
          </div>
        </div>
      </div>
      <ul className="mt-4 grid gap-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="truncate text-ink/90">{d.name}</span>
            </span>
            <span className="tabular-nums text-muted">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
