import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isSamePerson, type WikiPage } from "@/nlp/photo-match";

// Portraits come from Wikipedia's public API (images are on Wikimedia Commons under open licences), never from scraping.
// A photo is stored only if isSamePerson() confirms the page is the same person; the rest keep an initials avatar.
const API = "https://en.wikipedia.org/w/api.php";
const UA = "PodcastEcosystemRadar/1.0 (student project; public-API lookups, low volume)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ApiPage = { title: string; missing?: string; description?: string; extract?: string; thumbnail?: { source: string }; pageprops?: { disambiguation?: string }; pageid?: number };

export async function lookupPage(name: string): Promise<WikiPage | null> {
  const params = new URLSearchParams({ action: "query", format: "json", redirects: "1", titles: name, prop: "pageimages|extracts|description|pageprops", piprop: "thumbnail", pithumbsize: "240", exintro: "1", explaintext: "1", exchars: "700", ppprop: "disambiguation" });
  const res = await fetch(`${API}?${params}`, { headers: { "User-Agent": UA } });
  if (res.status === 429) {
    await sleep(5000);
    throw new Error("Wikipedia rate limit");
  }
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const json = (await res.json()) as { query?: { pages?: Record<string, ApiPage> } };
  const page = Object.values(json.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined) return null;
  return { title: page.title, description: page.description, extract: page.extract, thumbnail: page.thumbnail?.source, disambiguation: page.pageprops?.disambiguation !== undefined };
}

type Row = Record<string, unknown>;
async function rows<T = Row>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

/** Look up portraits for guests not checked in the last 30 days, most recently active first. */
export async function fillGuestPhotos(limit = 60) {
  const todo = await rows<{ id: number; name: string; company: string | null; role: string | null }>(sql`
    select g.id, g.canonical_name as name, g.company, g.role from guests g
    where (g.photo_checked_at is null or g.photo_checked_at < now() - interval '30 days') and g.needs_review = false
    order by (select max(e.published_at) from guest_appearances ga join episodes e on e.id = ga.episode_id where ga.guest_id = g.id) desc nulls last
    limit ${limit}`);
  const out = { checked: 0, found: 0, rejected: [] as string[], errors: 0 };
  for (const g of todo) {
    try {
      const page = await lookupPage(g.name);
      let photo: string | null = null;
      let source: string | null = null;
      if (page) {
        const m = isSamePerson(g, page);
        if (m.ok) {
          photo = page.thumbnail ?? null;
          source = `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;
        } else if (page.thumbnail) out.rejected.push(`${g.name}: ${m.why}`);
      }
      await db.execute(sql`update guests set photo_url = ${photo}, photo_source = ${source}, photo_checked_at = now() where id = ${g.id}`);
      out.checked++;
      if (photo) out.found++;
    } catch {
      out.errors++;
    }
    await sleep(1100); // polite pacing: Wikipedia rate-limits fast clients
  }
  return out;
}
