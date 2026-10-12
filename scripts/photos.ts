import "./env";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { fillGuestPhotos } from "@/services/photos";

// usage: npm run photos [-- --limit 60]   (Wikipedia public API; stores a portrait only when name AND company/role match)
async function main() {
  const i = process.argv.indexOf("--limit");
  const r = await fillGuestPhotos(i > 0 ? Number(process.argv[i + 1]) : 60);
  console.log(JSON.stringify({ checked: r.checked, found: r.found, errors: r.errors }));
  console.log("rejected (page existed but could not be confirmed):", r.rejected.slice(0, 10));
  const found = (await db.execute(sql`select canonical_name n, company c, photo_source s from guests where photo_url is not null`)) as unknown as { rows?: { n: string; c: string | null; s: string }[] } | { n: string; c: string | null; s: string }[];
  for (const g of Array.isArray(found) ? found : (found.rows ?? [])) console.log(` MATCH ${g.n} (${g.c ?? "-"}) <- ${g.s}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
