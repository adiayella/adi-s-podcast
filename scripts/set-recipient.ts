// Saves the Monday brief recipient in the database (settings.briefRecipient), the same row the /brief form writes.
// usage: npx tsx scripts/set-recipient.ts someone@example.com
import "./env";
import { z } from "zod";
import { db, schema } from "../src/db";

async function main() {
  const email = z.string().trim().email().max(200).parse(process.argv[2]);
  const now = new Date();
  await db.insert(schema.settings).values({ key: "briefRecipient", value: email, updatedAt: now }).onConflictDoUpdate({ target: schema.settings.key, set: { value: email, updatedAt: now } });
  console.log("Brief recipient saved in the database.");
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
