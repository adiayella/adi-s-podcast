import "./env";
import { neon } from "@neondatabase/serverless";
import { descriptionKey, isReupload, type KnownEpisode } from "@/services/episode-dedupe";

// usage: npm run dedupe [-- --apply]
// Finds episodes of the same show that are the same recording published again under a different title
// (same description, within 3 days). Dry run by default. With --apply the later copy is removed.
// Run `npm run resolve` afterwards so guest and sponsor counts are rebuilt without it.
const sql = neon(process.env.DATABASE_URL!);
const apply = process.argv.includes("--apply");

async function main() {
  const eps = await sql`select e.id, e.podcast_id, e.title, e.dedupe_key, e.description, e.published_at, p.name from episodes e join podcasts p on p.id = e.podcast_id order by e.podcast_id, e.published_at, e.id`;
  const byShow = new Map<number, typeof eps>();
  for (const e of eps) byShow.set(Number(e.podcast_id), [...(byShow.get(Number(e.podcast_id)) ?? []), e]);
  const doomed: { id: number; title: string; show: string; keeps: string }[] = [];
  for (const list of byShow.values()) {
    const kept: (KnownEpisode & { title: string })[] = [];
    for (const e of list) {
      const cand: KnownEpisode = { dedupeKey: String(e.dedupe_key), descKey: descriptionKey(e.description as string), publishedAt: new Date(e.published_at as string) };
      const match = kept.find((k) => isReupload(cand, [k]));
      if (match) doomed.push({ id: Number(e.id), title: String(e.title), show: String(e.name), keeps: match.title });
      else kept.push({ ...cand, title: String(e.title) });
    }
  }
  console.log(`${doomed.length} duplicate episode(s) found${apply ? "" : " (dry run)"}`);
  for (const d of doomed) console.log(`  [${d.show}] "${d.title.slice(0, 60)}"  duplicates  "${d.keeps.slice(0, 60)}"`);
  if (apply && doomed.length) {
    await sql`delete from episodes where id = any(${doomed.map((d) => d.id)})`;
    console.log("removed. now run: npm run resolve");
  } else if (doomed.length) console.log("re-run with --apply to remove them");
}
main().catch((e) => { console.error(e); process.exit(1); });
