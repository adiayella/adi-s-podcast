import type { Heat } from "@/services/overview";

// blue (rare) -> cyan -> amber (frequent), like a thermal scale
function colour(r: number): string {
  if (r <= 0) return "rgba(160,174,220,0.06)";
  const stops: [number, [number, number, number]][] = [[0, [29, 58, 138]], [0.5, [37, 99, 235]], [0.8, [56, 189, 248]], [1, [245, 158, 11]]];
  for (let i = 1; i < stops.length; i++) {
    if (r <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (r - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(",")})`;
    }
  }
  return "rgb(245,158,11)";
}

export function ConvergenceHeatmap({ heat }: { heat: Heat }) {
  const n = heat.topics.length;
  if (!n) return <p className="py-10 text-center text-muted">No analysed episodes yet.</p>;
  const cell = (a: number, b: number) => heat.cells.find((c) => c.a === a && c.b === b);
  const short = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4">
      <div className="min-w-0 overflow-x-auto">
        <div className="grid min-w-[420px] gap-[3px]" style={{ gridTemplateColumns: `130px repeat(${n}, minmax(0, 1fr))` }} role="img" aria-label="Topic convergence heatmap: how many episodes carry both topics">
          {heat.topics.map((rowName, a) => (
            <div key={rowName} className="contents">
              <span className="truncate pr-2 text-right text-xs leading-7 text-muted" title={rowName}>
                {short(rowName)}
              </span>
              {heat.topics.map((colName, b) => {
                const c = cell(a, b);
                const diag = a === b;
                const r = !c ? 0 : diag ? 0.35 : c.episodes / heat.max;
                return (
                  <span
                    key={colName}
                    title={diag ? `${rowName}: ${c?.episodes ?? 0} episodes in total` : `${rowName} × ${colName}\n${c?.episodes ?? 0} episodes\n${c?.guests ?? 0} unique guests\n${c?.sponsors ?? 0} disclosed sponsors`}
                    className="h-7 rounded-[3px]"
                    style={{ background: diag ? "rgba(139,92,246,0.45)" : colour(r) }}
                  />
                );
              })}
            </div>
          ))}
          <span />
          {heat.topics.map((t) => (
            <span key={t} className="truncate pt-1 text-center text-[10px] text-muted" title={t}>
              {t.split(/[ &]/)[0]}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 text-xs text-muted" aria-hidden>
        <span>{heat.max}</span>
        <span className="w-3 flex-1 rounded-full" style={{ background: "linear-gradient(to bottom, rgb(245,158,11), rgb(56,189,248), rgb(37,99,235), rgb(29,58,138))" }} />
        <span>0</span>
      </div>
    </div>
  );
}
