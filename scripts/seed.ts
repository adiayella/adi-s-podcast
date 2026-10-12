import "./env";
import { db, schema } from "@/db";
import { SEED_PODCASTS } from "@/data/podcast-seed";

async function main() {
  const inserted = await db
    .insert(schema.podcasts)
    .values(
      SEED_PODCASTS.map((p) => ({
        name: p.name,
        rssUrl: p.rssUrl,
        youtubeChannelId: p.youtubeChannelId ?? null,
        enabled: p.enabled,
      })),
    )
    .onConflictDoNothing({ target: schema.podcasts.rssUrl })
    .returning({ id: schema.podcasts.id });
  console.log(`seeded ${inserted.length} new podcasts (${SEED_PODCASTS.length - inserted.length} already existed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
