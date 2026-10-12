// Runs the Spotify sector trend scan now and prints a short summary per sector. Pass --force to rescan today.
import "./env";
import { getSpotifyTrends, runSpotifyTrends } from "../src/services/spotify-trends";

async function main() {
  const run = await runSpotifyTrends({ force: process.argv.includes("--force"), budgetMs: 280_000 });
  console.log(JSON.stringify(run, null, 2));
  for (const s of await getSpotifyTrends()) {
    const top = s.shows.slice(0, 3).map((x) => `${x.name} ${x.score} ${x.label}${x.youtube ? ` (YT median ${x.youtube.medianViews} views)` : ""}`);
    console.log(`\n${s.sector}: ${s.heat.label} · ${s.heat.episodes30d} vs ${s.heat.episodesPrev30d} sector episodes · ${s.heat.hotOrRising} hot/rising\n  ${top.join("\n  ")}`);
  }
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
