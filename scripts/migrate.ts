import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

config({ path: ".env.local" });

async function main() {
  const db = drizzle(neon(process.env.DATABASE_URL!));
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrations applied");
}

main().catch((e) => {
  console.error("migration failed:", e.message);
  process.exit(1);
});
