// Gives every stored episode a link that opens: the exact Spotify episode when matched, else the YouTube video,
// else a Spotify search for the exact title. The feed's original link stays in episode_sources.
// Dry run by default; pass --apply to write.
import "./env";
import { repairEpisodeLinks } from "../src/services/spotify-links";

async function main() {
  const apply = process.argv.includes("--apply");
  const r = await repairEpisodeLinks({ apply });
  console.log(JSON.stringify(r, null, 2));
  if (!apply) console.log("Dry run. Pass --apply to write.");
}
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
