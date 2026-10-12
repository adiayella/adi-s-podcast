import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Panel({
  title,
  icon: Icon,
  right,
  children,
  className = "",
}: {
  title: string;
  icon?: LucideIcon;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl bg-panel p-5 ring-1 ring-line ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="grid size-9 place-items-center rounded-xl bg-accent/20 text-soft">
              <Icon size={18} />
            </span>
          )}
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  delta,
  hint,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  delta?: { pct: number | null; label?: string };
  hint?: string;
}) {
  const up = delta && delta.pct !== null && delta.pct >= 0;
  return (
    <div className="rounded-2xl bg-panel p-5 ring-1 ring-line">
      <div className="flex items-center gap-3 text-[15px] text-ink/90">
        <span className="grid size-9 place-items-center rounded-xl bg-accent/20 text-soft">
          <Icon size={18} />
        </span>
        {label}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-4xl font-semibold tracking-tight tabular-nums">{value}</p>
        {delta && delta.pct !== null && (
          <span
            className={`mb-1 inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-sm font-medium ${
              up ? "bg-good/20 text-good" : "bg-bad/20 text-bad"
            }`}
            title={delta.label}
          >
            {up ? "+" : ""}
            {delta.pct.toFixed(1)}%
            <ArrowUpRight size={14} className={up ? "" : "rotate-90"} />
          </span>
        )}
      </div>
      {hint && <p className="mt-2 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-panel/60 px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-accent/20 text-soft">
        <Icon size={22} />
      </span>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <div className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-panel2 text-muted",
    good: "bg-good/15 text-good",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
  };
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function PanelSkeleton({ className = "h-64" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-panel/70 ring-1 ring-line ${className}`} />;
}
