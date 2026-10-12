import "./env";
import { buildClusters, embedMissingEpisodes } from "@/services/semantic";

// usage: npm run semantic   (embeds new episodes, then rebuilds the semantic topic clusters)
async function main() {
  console.log("embedding:", JSON.stringify(await embedMissingEpisodes()));
  const r = await buildClusters();
  console.log(`clusters: ${r.clusters} from ${r.episodesConsidered} episodes (naming: ${r.naming})`);
  r.labels.forEach((l, i) => console.log(` ${i + 1}. ${l}`));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
