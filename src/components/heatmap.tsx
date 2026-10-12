const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BUCKETS = ["12–4am", "4–8am", "8am–12", "12–4pm", "4–8pm", "8pm–12"];

export function PublishingHeatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-1.5 text-center text-xs" aria-label="Episodes published by weekday and time of day, IST">
        <thead>
          <tr>
            <th />
            {DAYS.map((d) => (
              <th key={d} className="pb-1 font-normal text-muted">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, b) => (
            <tr key={b}>
              <th className="pr-2 text-right font-normal whitespace-nowrap text-muted">{BUCKETS[b]}</th>
              {row.map((n, d) => (
                <td
                  key={d}
                  title={`${DAYS[d]} ${BUCKETS[b]} IST: ${n} episodes`}
                  className="h-9 rounded-lg text-[13px] font-medium tabular-nums"
                  style={{
                    background: n === 0 ? "rgba(160,174,220,0.07)" : `rgba(91,108,240,${0.25 + 0.75 * (n / max)})`,
                    color: n === 0 ? "#5d6a8f" : "#fff",
                  }}
                >
                  {n || ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
