import "./env";
import { analysisProgress, enqueueAnalysis, runAnalysisBatch } from "@/services/analyze";

// usage: npm run analyze -- [--batch 20] [--max 500]
const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => Number(args[args.indexOf(name) + 1]) || fallback;
const batch = arg("--batch", 20);
const max = arg("--max", 1000);

async function main() {
  const queued = await enqueueAnalysis();
  console.log(`queued ${queued} new jobs`);
  let processed = 0;
  while (processed < max) {
    const s = await runAnalysisBatch(batch, 4);
    if (s.claimed === 0) break;
    processed += s.claimed;
    console.log(`batch: claimed ${s.claimed}, done ${s.done}, failed ${s.failed}${s.errors.length ? " | " + s.errors[0] : ""}`);
  }
  console.log("progress:", await analysisProgress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
