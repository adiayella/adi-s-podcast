import "./env";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { syncYoutube } from "@/services/youtube";

// usage: npm run youtube -- [--days 90] [--set "Podcast name=UCchannelId" ...]
const args = process.argv.slice(2);
const days = Number(args[args.indexOf("--days") + 1]) || 90;

async function main() {
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--set") continue;
    const [name, channel] = args[i + 1].split("=");
    await db.update(schema.podcasts).set({ youtubeChannelId: channel }).where(eq(schema.podcasts.name, name));
    console.log(`set ${name} -> ${channel}`);
  }
  const list = await db.select().from(schema.podcasts).where(eq(schema.podcasts.enabled, true));
  for (const p of list) {
    if (!p.youtubeChannelId) {
      console.log(`skip  ${p.name}: no channel`);
      continue;
    }
    const r = await syncYoutube(p, days);
    console.log(`${r.error ? "FAIL" : "ok  "} ${p.name}: long videos ${r.longVideos}, matched ${r.matched}, paid-flagged ${r.paidFlagged}, unmatched ${r.unmatched.length}${r.error ? " | " + r.error : ""}`);
    for (const u of r.unmatched.slice(0, 2)) console.log(`        unmatched: ${u}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

