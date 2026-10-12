// Runs the smart search for a few queries and prints what the page would show. Usage: npx tsx scripts/search-check.ts "query" ...
import "./env";
import { smartSearch, spotifyLive } from "../src/services/search";

async function main() {
  const qs = process.argv.slice(2).length ? process.argv.slice(2) : ["sports startup"];
  for (const q of qs) {
    const t = Date.now();
    const [r, s] = await Promise.all([smartSearch(q), spotifyLive(q)]);
    console.log(`\n=== ${q} (${((Date.now() - t) / 1000).toFixed(1)}s, ${r.method}, ${r.considered} considered${r.error ? `, error: ${r.error}` : ""})`);
    console.log(`summary: ${r.summary}`);
    for (const m of r.matches) console.log(`  - ${m.title.slice(0, 80)} · ${m.podcast}\n      ${m.why}`);
    console.log(`spotify: ${s.shows.map((x) => x.name).join(" | ")}\n  eps: ${s.episodes.slice(0, 4).map((x) => x.title.slice(0, 60)).join(" | ")}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
