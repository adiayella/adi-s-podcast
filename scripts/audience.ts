import "./env";
import { buildAudienceThemes, runAudienceAnalysis, topAudienceThemes } from "@/services/audience";

// usage: npm run audience [-- --videos 8] [--force]   (reads a bounded sample of public comments; ~1 YouTube unit + 1 Gemini call per video)
async function main() {
  const v = process.argv.indexOf("--videos");
  const run = await runAudienceAnalysis({ maxVideos: v > 0 ? Number(process.argv[v + 1]) : 8, force: process.argv.includes("--force") });
  console.log("analysis:", JSON.stringify(run));
  console.log("themes:", JSON.stringify(await buildAudienceThemes()));
  for (const t of await topAudienceThemes(8)) console.log(`  [${t.kind}] ${t.label}  (${t.support} comments, ${t.videos} video(s))\n     e.g. "${(t.quotes as string[])[0] ?? ""}"`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
