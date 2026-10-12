import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getGuestRadar, getSponsorRadar, getTopicRadar, parsePeriod } from "@/services/radars";

const { scoreSnapshots } = schema;

/** Monday of the current week in IST, as YYYY-MM-DD. */
export function currentWeekStartIST(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const day = (ist.getUTCDay() + 6) % 7; // Monday = 0
  ist.setUTCDate(ist.getUTCDate() - day);
  return ist.toISOString().slice(0, 10);
}

/**
 * Store this week's scores with the raw counts and weights behind them, so any past ranking can be
 * reproduced and compared. Re-running in the same week overwrites that week's rows (no duplicates).
 */
export async function saveSnapshots(weekStart = currentWeekStartIST()) {
  const guests = await getGuestRadar({ period: parsePeriod("90d") });
  const topics = await getTopicRadar();
  const sponsors = await getSponsorRadar({ period: parsePeriod("90d") });

  const rows: (typeof scoreSnapshots.$inferInsert)[] = [
    ...guests.map((g) => ({
      kind: "guest" as const,
      entityId: g.id,
      weekStart,
      score: String(g.score.score),
      rawCounts: { distinctPodcasts: g.distinctPodcasts, appearances: g.appearances, rawAppearances: g.rawAppearances, lastAt: g.lastAt, confidence: g.confidence },
      components: g.score.components,
    })),
    ...topics.map((t) => ({
      kind: "topic" as const,
      entityId: t.id,
      weekStart,
      score: String(t.score.score),
      rawCounts: { distinctPodcasts: t.distinctPodcasts, episodes30d: t.episodes30d, episodesThisWeek: t.episodesThisWeek, episodesPrevWeek: t.episodesPrevWeek, confidence: t.confidence },
      components: t.score.components,
    })),
    ...sponsors.map((s) => ({
      kind: "sponsor" as const,
      entityId: s.id,
      weekStart,
      score: String(s.score.score),
      rawCounts: { confirmedEpisodes: s.confirmedEpisodes, confirmedPodcasts: s.confirmedPodcasts, promoEpisodes: s.promoEpisodes, platformFlaggedEpisodes: s.platformFlaggedEpisodes, tier: s.tier, signal: s.signal.score },
      components: s.score.components,
    })),
  ];
  for (let i = 0; i < rows.length; i += 200) {
    await db
      .insert(scoreSnapshots)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [scoreSnapshots.kind, scoreSnapshots.entityId, scoreSnapshots.weekStart],
        set: { score: sqlExcluded("score"), rawCounts: sqlExcluded("raw_counts"), components: sqlExcluded("components") },
      });
  }
  return { weekStart, guests: guests.length, topics: topics.length, sponsors: sponsors.length };
}

function sqlExcluded(col: string) {
  return sql.raw(`excluded."${col}"`);
}
