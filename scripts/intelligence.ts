import "./env";
import { getSectorTrends, latestOpportunities, scoreOpportunities } from "@/services/intelligence";

// usage: npm run intelligence   (scores guests and sponsors with the active rubric and prints sector trends)
async function main() {
  console.log("scored:", JSON.stringify(await scoreOpportunities()));
  console.log("\nSECTORS");
  for (const s of (await getSectorTrends()).slice(0, 8))
    console.log(` ${s.name.padEnd(28)} ${s.episodesThisWeek} vs ${s.episodesPrevWeek} (${s.trend}) · perf ${s.perfIndex ?? "n/a"} · per1k ${s.per1k ?? "n/a"} · gained7d ${s.viewsGained7d ?? "no history yet"} · confidence ${s.confidence.level}`);
  for (const kind of ["guest", "sponsor"] as const) {
    console.log(`\nTOP ${kind.toUpperCase()}S`);
    for (const o of await latestOpportunities(kind, 5)) console.log(` ${o.score.padStart(5)}  ${o.name}${o.company ? ` (${o.company})` : ""} · confidence ${o.confidence.level}${o.missing.length ? ` · missing: ${o.missing.join(", ")}` : ""}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
