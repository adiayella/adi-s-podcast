import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { ResearchConfig } from "@/research/config";
import { episodeFocus } from "@/research/focus";
import { getActiveConfig } from "@/services/research-settings";

// Applies the founder's preferences to the MONITORED universe: which episodes match their focus and
// which are excluded. Discovery data never passes through here.

export type FocusContext = { version: number; config: ResearchConfig; excluded: Set<number>; matches: Set<number> };

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

export async function getFocusContext(): Promise<FocusContext> {
  const { version, config } = await getActiveConfig();
  const eps = await rows<{ id: number; podcastId: number; title: string; description: string; topics: string[] | null }>(sql`
    select e.id, e.podcast_id as "podcastId", e.title, left(coalesce(e.description, ''), 3000) as description,
           (select array_agg(t.name) from episode_topics et join topics t on t.id = et.topic_id where et.episode_id = e.id) as topics
    from episodes e join podcasts p on p.id = e.podcast_id and p.enabled
    where e.published_at > now() - interval '400 days'`);
  const excluded = new Set<number>();
  const matches = new Set<number>();
  for (const e of eps) {
    const f = episodeFocus({ title: e.title, description: e.description, topics: e.topics ?? [], podcastId: e.podcastId }, config);
    if (f.excluded) excluded.add(e.id);
    else if (f.isMatch) matches.add(e.id);
  }
  return { version, config, excluded, matches };
}

/** `and <column> not in (...)`, or nothing when no episode is excluded. */
export function notExcluded(column: SQL | string, excluded: Set<number>): SQL {
  if (excluded.size === 0) return sql``;
  const col = typeof column === "string" ? sql.raw(column) : column;
  return sql`and ${col} not in (${sql.join([...excluded].map((id) => sql`${id}`), sql`, `)})`;
}
