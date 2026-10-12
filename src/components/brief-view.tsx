import type { BriefDoc } from "@/services/brief-render";

/** Renders the same structured brief that is emailed, in the dashboard's style. */
export function BriefView({ doc }: { doc: BriefDoc }) {
  return (
    <div className="grid gap-6">
      {doc.sections.map((s, idx) => (
        <div key={`${s.heading}-${idx}`} className="grid gap-4">
          {s.group && (
            <div className="rounded-2xl bg-gradient-to-r from-accent/30 to-accent2/25 p-5 ring-1 ring-line">
              <p className="text-xs tracking-wider text-soft uppercase">Section</p>
              <h2 className="text-2xl font-semibold tracking-tight">{s.group}</h2>
              {s.groupNote && <p className="mt-1.5 text-sm leading-relaxed text-ink/80">{s.groupNote}</p>}
            </div>
          )}
          <section className="rounded-2xl bg-panel p-5 ring-1 ring-line">
            <h3 className="mb-3 text-lg font-semibold">{s.heading}</h3>
            <div className="grid gap-3">
              {s.blocks.map((b, i) =>
                b.kind === "p" ? (
                  <p key={i} className={`text-[15px] leading-relaxed ${b.muted ? "text-muted" : "text-ink/90"}`}>
                    {b.text}
                  </p>
                ) : (
                  <div key={i} className="rounded-xl bg-panel2 p-4">
                    <p className="font-semibold">{b.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{b.meta}</p>
                    {b.body?.map((line, j) => (
                      <p key={j} className="mt-2 text-[15px] leading-relaxed text-ink/90">
                        {line}
                      </p>
                    ))}
                    {b.links && b.links.length > 0 && (
                      <ul className="mt-2 grid gap-1 text-sm">
                        {b.links.map((l, k) => (
                          <li key={k}>
                            <a href={l.url} target="_blank" rel="noreferrer" className="line-clamp-1 text-soft hover:underline">
                              {l.label}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ),
              )}
            </div>
          </section>
        </div>
      ))}
    </div>
  );
}
