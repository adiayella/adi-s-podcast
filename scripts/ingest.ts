import "./env";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ingestPodcast } from "@/services/ingest";

// usage: npm run ingest -- [--days 90] [--all]   (--all includes disabled podcasts)
const args = process.argv.slice(2);
const days = Number(args[args.indexOf("--days") + 1]) || 90;
const includeDisabled = args.includes("--all");

async function main() {
  const list = includeDisabled
    ? await db.select().from(schema.podcasts)
    : await db.select().from(schema.podcasts).where(eq(schema.podcasts.enabled, true));
  console.log(`ingesting ${list.length} podcasts, last ${days} days`);
  let total = 0;
  for (const p of list) {
    const r = await ingestPodcast(p, days);
    total += r.inserted;
    console.log(`${r.error ? "FAIL" : "ok  "} ${r.name}: seen ${r.seen}, new ${r.inserted}${r.error ? " - " + r.error : ""}`);
  }
  console.log(`done, ${total} new episodes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
