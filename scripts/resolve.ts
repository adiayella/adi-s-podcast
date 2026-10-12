import "./env";
import { neon } from "@neondatabase/serverless";
import { resolveAll } from "@/services/resolve";

// usage: npm run resolve [-- --reset]   (--reset wipes derived entity tables first; they are rebuilt from stored model output)
async function main() {
  if (process.argv.includes("--reset")) {
    const sql = neon(process.env.DATABASE_URL!);
    for (const table of ["sponsor_evidence", "guest_appearances", "brand_aliases", "guest_aliases", "brands", "guests"]) {
      await sql.query(`delete from ${table}`);
    }
    console.log("derived entity tables cleared");
  }
  console.log("resolved:", await resolveAll());
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
