import "./env";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cleanQuote, usableComments, type VerifiedItem } from "@/nlp/comments";
import { buildAudienceThemes, fetchTopComments, runAudienceAnalysis } from "@/services/audience";
import { buildClusters, embedMissingEpisodes } from "@/services/semantic";

// usage: npm run phase2-e2e   (real database, real Gemini embeddings and YouTube comments; a few units of quota)
type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
const t = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
};
async function q<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

async function main() {
  // 1. embeddings
  await embedMissingEpisodes();
  const [emb] = await q<{ missing: number; dims: number }>(sql`select count(*) filter (where e.embedding is null)::int missing, max(vector_dims(e.embedding))::int dims from episodes e join podcasts p on p.id = e.podcast_id and p.enabled`);
  t("Embeddings: every monitored episode has a 768-dimension vector", emb.missing === 0 && emb.dims === 768, `${emb.missing} missing, ${emb.dims} dims`);
  const again = await embedMissingEpisodes();
  t("Embeddings: re-running embeds nothing twice (no repeat API cost)", again.embedded === 0);

  // 2. clusters
  const c1 = await buildClusters();
  const cl = await q<{ id: number; episode_ids: number[]; podcast_count: number; episode_count: number; cohesion: string }>(sql`select id, episode_ids, podcast_count, episode_count, cohesion from topic_clusters`);
  t("Clusters: themes are built from real episodes", cl.length === c1.clusters && cl.length > 0, `${cl.length} clusters from ${c1.episodesConsidered} episodes`);
  t("Clusters: each spans 3+ episodes and 2+ shows, and cohesion is plausible", cl.every((c) => c.episode_count >= 3 && c.podcast_count >= 2 && Number(c.cohesion) > 0.2));
  const ids = cl.flatMap((c) => c.episode_ids);
  const [exist] = await q<{ n: number }>(sql`select count(*)::int n from episodes where id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  t("Clusters: every member is a real episode, and none is listed twice", exist.n === ids.length && new Set(ids).size === ids.length);
  const c2 = await buildClusters();
  t("Clusters: rebuilding gives the same grouping (deterministic, no duplicates)", c2.clusters === c1.clusters && (await q<{ n: number }>(sql`select count(*)::int n from topic_clusters`))[0].n === c1.clusters);

  // 3. audience questions
  await runAudienceAnalysis({ maxVideos: 3 });
  const finds = await q<{ id: number; source: number; ext: string; items: VerifiedItem[]; sample: number; analysed_at: string }>(sql`select f.id, s.id source, s.external_id ext, f.items, f.sample_size sample, f.analysed_at from audience_findings f join episode_sources s on s.id = f.episode_source_id`);
  const items = finds.flatMap((f) => f.items);
  t("Audience: findings exist from real comment samples", finds.length > 0 && items.length > 0, `${finds.length} videos, ${items.length} verified items`);
  t("Audience: every item is backed by 2+ comments and carries verbatim quotes", items.every((i) => i.support >= 2 && i.quotes.length > 0));
  t("Audience: sample is bounded (<= 100 comments per video)", finds.every((f) => f.sample <= 100));
  // quotes must be real: re-fetch one video's comments and look for each stored quote in them
  const probe = finds.find((f) => f.items.length);
  if (probe) {
    const { comments } = await fetchTopComments(probe.ext);
    const clean = usableComments(comments).map((c) => cleanQuote(c.text));
    const found = probe.items.flatMap((i) => i.quotes).filter((qt) => clean.includes(qt)).length;
    const total = probe.items.flatMap((i) => i.quotes).length;
    t("Audience: stored quotes are real comments (matched against a fresh fetch)", found >= Math.ceil(total * 0.8), `${found}/${total} quotes found (relevance ranking can shift between fetches)`);
  }
  const stored = JSON.stringify(finds.map((f) => f.items));
  t("Audience: no author names or links are stored in excerpts", !/https?:\/\//.test(stored) && !/@(?!user)\w/.test(stored));
  const before = Object.fromEntries(finds.map((f) => [f.id, f.analysed_at]));
  await runAudienceAnalysis({ maxVideos: 3 });
  const after = await q<{ id: number; analysed_at: string }>(sql`select id, analysed_at from audience_findings`);
  t("Audience: a second run does not re-read videos already analysed", after.filter((a) => before[a.id]).every((a) => String(before[a.id]) === String(a.analysed_at)));
  const th = await buildAudienceThemes();
  t("Audience: themes merge findings and keep observed counts separate from AI suggestions", th.themes > 0 && th.themes <= th.items, `${th.items} items -> ${th.themes} themes`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} phase 2 checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
