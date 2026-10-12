import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const ext = await sql`select extname from pg_extension where extname = 'vector'`;
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  console.log("pgvector:", ext.length ? "enabled" : "missing");
  console.log(`public tables (${tables.length}):`, tables.map((t) => t.table_name).join(", ") || "none");
}

main().catch((e) => {
  console.error("DB check failed:", e.message);
  process.exit(1);
});
