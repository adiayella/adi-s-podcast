import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Radio, SearchX, Sparkles } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Badge, EmptyState, PageHeader, Panel, PanelSkeleton } from "@/components/ui";
import { formatDateIST } from "@/lib/format";
import { searchAll } from "@/services/overview";
import { smartSearch, spotifyLive } from "@/services/search";

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Suspense fallback={<PanelSkeleton className="h-96" />}>
      <Results searchParams={searchParams} />
    </Suspense>
  );
}

const ExternalLink = ({ href, children }: { href: string | null; children: React.ReactNode }) =>
  href && /^https?:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:decoration-accent">
      {children}
    </a>
  ) : (
    <>{children}</>
  );

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 80) ?? "";
  if (q.length < 2) return <PageHeader title="Search" subtitle="Type at least two characters in the search box." />;
  return (
    <div className="grid gap-5">
      <PageHeader title={`Results for “${q}”`} subtitle="What the radar's episodes say about it, live results from Spotify, and direct matches on guests, companies, topics and shows." />
      <Suspense fallback={<PanelSkeleton className="h-64" />}>
        <Answer q={q} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton className="h-48" />}>
        <SpotifyResults q={q} />
      </Suspense>
      <Suspense fallback={<PanelSkeleton className="h-32" />}>
        <DirectMatches q={q} />
      </Suspense>
    </div>
  );
}

async function Answer({ q }: { q: string }) {
  await connection();
  const r = await smartSearch(q);
  return (
    <Panel title="From the radar's episodes" icon={Sparkles} right={<span className="text-sm text-muted">{r.considered} episodes considered</span>}>
      {r.summary && <p className="mb-4 text-[15px] leading-relaxed text-ink/90">{r.summary}</p>}
      {r.matches.length ? (
        <ul className="grid gap-3 text-[15px]">
          {r.matches.map((m) => (
            <li key={m.title + m.at}>
              <ExternalLink href={m.url}>{m.title}</ExternalLink>
              <span className="text-sm text-muted">
                {" "}
                · {m.podcast} · {formatDateIST(m.at)}
              </span>{" "}
              {m.source === "discovery" && <Badge>found by discovery</Badge>}
              <p className="mt-0.5 text-sm text-soft">{m.why}</p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={SearchX} title="No episode on this yet">
          <p>None of the episodes the radar monitors or has discovered discuss it. The Spotify results below cover the wider podcast world.</p>
        </EmptyState>
      )}
      <p className="mt-4 text-xs text-muted">
        {r.method === "gemini"
          ? "Candidates come from word matches and closeness of meaning (embeddings); Gemini Flash keeps only the relevant ones and writes the summary from them alone."
          : `Showing word matches only${r.error ? ` (AI ranking unavailable: ${r.error})` : ""}.`}
      </p>
    </Panel>
  );
}

async function SpotifyResults({ q }: { q: string }) {
  await connection();
  const r = await spotifyLive(q);
  if (!r.configured) return null;
  return (
    <Panel title="On Spotify now" icon={Radio} right={<span className="text-sm text-muted">live from Spotify (India)</span>}>
      {r.error && <p className="text-sm text-bad">Spotify search failed: {r.error}</p>}
      {r.shows.length > 0 && (
        <>
          <p className="mb-2 text-sm font-medium text-muted">Shows</p>
          <ul className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {r.shows.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                {s.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.imageUrl} alt="" width={48} height={48} loading="lazy" referrerPolicy="no-referrer" className="size-12 shrink-0 rounded-lg object-cover ring-1 ring-line" />
                ) : (
                  <div className="size-12 shrink-0 rounded-lg bg-panel2 ring-1 ring-line" />
                )}
                <span className="min-w-0">
                  <a href={s.url} target="_blank" rel="noreferrer" className="line-clamp-1 font-medium hover:underline">
                    {s.name}
                  </a>
                  <span className="block text-sm text-muted">
                    {s.totalEpisodes.toLocaleString("en-IN")} episodes{s.languages.length ? ` · ${s.languages.join(", ")}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {r.episodes.length > 0 && (
        <>
          <p className="mb-2 text-sm font-medium text-muted">Episodes</p>
          <ul className="grid gap-2 text-[15px]">
            {r.episodes.map((e) => (
              <li key={e.id}>
                <ExternalLink href={e.url}>{e.title}</ExternalLink>
                <span className="text-sm text-muted">
                  {" "}
                  {e.date ? `· ${e.date}` : ""} · {e.durationMinutes} min
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!r.error && !r.shows.length && !r.episodes.length && <p className="text-muted">Spotify returned nothing for this search.</p>}
      <p className="mt-4 text-xs text-muted">Results, titles and artwork from Spotify, in Spotify&apos;s order. They are not stored and not analysed by AI.</p>
    </Panel>
  );
}

async function DirectMatches({ q }: { q: string }) {
  await connection();
  const r = await searchAll(q);
  const total = r.guests.length + r.podcasts.length + r.topics.length + r.brands.length;
  if (!total) return null;
  return (
    <>
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
    </>
  );
}
