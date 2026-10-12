import Link from "next/link";
import type { RangeDays } from "@/lib/queries";

const OPTIONS: { v: RangeDays; label: string }[] = [
  { v: 7, label: "7 days" },
  { v: 30, label: "30 days" },
  { v: 90, label: "90 days" },
];

export function RangeTabs({ current, basePath }: { current: RangeDays; basePath: string }) {
  return (
    <nav aria-label="Date range" className="inline-flex rounded-xl bg-panel p-1 ring-1 ring-line">
      {OPTIONS.map((o) => (
        <Link
          key={o.v}
          href={`${basePath}?range=${o.v}`}
          aria-current={o.v === current ? "true" : undefined}
          className={`rounded-lg px-3.5 py-1.5 text-sm transition-colors ${
            o.v === current ? "bg-accent text-white" : "text-muted hover:text-ink"
          }`}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
