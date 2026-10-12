import "./env";
import { generateBrief, sendBrief } from "@/services/brief";
import { latestReports } from "@/services/brief";

// usage: npm run brief [-- --send] [--force]   (without --send it only generates and prints)
async function main() {
  const force = process.argv.includes("--force");
  const gen = await generateBrief({ force });
  console.log("generated:", JSON.stringify(gen));
  const [report] = await latestReports(1);
  console.log("\n" + report.briefMarkdown);
  if (process.argv.includes("--send")) console.log("\nsend:", await sendBrief({ reportId: gen.id, force }));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
