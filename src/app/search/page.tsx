import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { SearchX } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState, PageHeader, Panel, PanelSkeleton } from "@/components/ui";
import { formatDateIST } from "@/lib/format";
import { searchAll } from "@/services/overview";

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <>
      <Suspense fallback={<PanelSkeleton className="h-96" />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 80) ?? "";
  if (q.length < 2) return <PageHeader title="Search" subtitle="Type at least two characters in the search box." />;
  const r = await searchAll(q);
  const total = r.guests.length + r.podcasts.length + r.topics.length + r.brands.length + r.episodes.length;
  return (
    <div className="grid gap-5">
      <PageHeader title={`Results for “${q}”`} subtitle={`${total} match${total === 1 ? "" : "es"} across guests, podcasts, topics, companies and episodes`} />
      {total === 0 && (
        <EmptyState icon={SearchX} title="Nothing found">
          <p>Try a shorter name, or a company or topic. Search covers only what the radar has seen.</p>
        </EmptyState>
      )}
      {r.guests.length > 0 && (
        <Panel title="Guests">
          <ul className="grid gap-3 sm:grid-cols-2">
            {r.guests.map((g) => (
              <li key={g.id} className="flex items-center gap-3">
                <Avatar name={g.name} src={g.photo} />
                <span>
                  <Link href={`/guests?q=${encodeURIComponent(g.name)}`} className="font-medium hover:underline">
                    {g.name}
                  </Link>
                  <span className="block text-sm text-muted">{[g.role, g.company].filter(Boolean).join(", ") || "role not stated"}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {r.topics.length > 0 && (
        <Panel title="Topics">
          <ul className="flex flex-wrap gap-2">
            {r.topics.map((t) => (
              <li key={t.name} className="rounded-lg bg-panel2 px-3 py-1.5 text-sm ring-1 ring-line">
                {t.name} <span className="text-muted">· {t.episodes} episodes</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {r.brands.length > 0 && (
        <Panel title="Companies and sponsors">
          <ul className="flex flex-wrap gap-2">
            {r.brands.map((b) => (
              <li key={b.id} className="rounded-lg bg-panel2 px-3 py-1.5 text-sm ring-1 ring-line">
                {b.name} {b.category && <span className="text-muted">· {b.category}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {r.podcasts.length > 0 && (
        <Panel title="Podcasts">
          <ul className="flex flex-wrap gap-2">
            {r.podcasts.map((p) => (
              <li key={p.id} className="rounded-lg bg-panel2 px-3 py-1.5 text-sm ring-1 ring-line">
                {p.name}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {r.episodes.length > 0 && (
        <Panel title="Episodes">
          <ul className="grid gap-2 text-[15px]">
            {r.episodes.map((e) => (
              <li key={e.title + e.at}>
                {e.url && /^https?:\/\//.test(e.url) ? (
                  <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:decoration-accent">
                    {e.title}
                  </a>
                ) : (
                  e.title
                )}{" "}
                <span className="text-sm text-muted">
                  · {e.podcast} · {formatDateIST(e.at)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
