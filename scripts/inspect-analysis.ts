import "./env";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const topics = await sql`
    select t.name, count(*)::int eps, count(distinct e.podcast_id)::int shows
    from episode_topics et join topics t on t.id = et.topic_id join episodes e on e.id = et.episode_id
    group by t.name order by eps desc`;
  console.log("TOPICS (episodes / shows)");
  for (const t of topics) console.log(`  ${String(t.eps).padStart(3)} / ${t.shows}  ${t.name}`);

  const types = await sql`select raw_output->'extraction'->>'episodeType' as type, count(*)::int n from analysis_jobs where status='done' and prompt_version='v2' group by 1 order by n desc`;
  console.log("\nEPISODE TYPES:", types.map((r) => `${r.type}=${r.n}`).join("  "));

  const guests = await sql`
    select g->>'name' as name, count(*)::int eps, count(distinct e.podcast_id)::int shows
    from analysis_jobs j join episodes e on e.id = j.episode_id,
         jsonb_array_elements(j.raw_output->'extraction'->'guests') g
    where j.status='done' and j.prompt_version = 'v2' group by 1 order by shows desc, eps desc, 1 limit 15`;
  const [gt] = await sql`select count(*)::int n from analysis_jobs j, jsonb_array_elements(j.raw_output->'extraction'->'guests') where j.status='done' and j.prompt_version='v2'`;
  console.log(`\nGUEST MENTIONS: ${gt.n} total. Most repeated:`);
  for (const g of guests) console.log(`  ${g.name} - ${g.eps} episodes on ${g.shows} show(s)`);

  const sp = await sql`
    select s->>'brand' brand, s->>'classification' cls, p.name podcast, left(s->>'evidence', 110) ev
    from analysis_jobs j join episodes e on e.id = j.episode_id join podcasts p on p.id = e.podcast_id,
         jsonb_array_elements(j.raw_output->'extraction'->'sponsors') s
    where j.status='done' and j.prompt_version='v2' order by cls, brand`;
  console.log(`\nSPONSOR FINDINGS: ${sp.length}`);
  for (const s of sp) console.log(`  [${s.cls}] ${s.brand} | ${s.podcast} | "${s.ev}"`);

  const [rej] = await sql`
    select sum(jsonb_array_length(raw_output->'rejected'->'guests'))::int g,
           sum(jsonb_array_length(raw_output->'rejected'->'sponsors'))::int s,
           sum(jsonb_array_length(raw_output->'rejected'->'downgraded'))::int d,
           sum((raw_output->'usage'->>'in')::int)::int tin, sum((raw_output->'usage'->>'out')::int)::int tout
    from analysis_jobs where status='done' and prompt_version='v2'`;
  console.log(`\nREJECTED BY VERIFICATION: guests=${rej.g} sponsors=${rej.s} downgraded=${rej.d}`);
  console.log(`TOKENS: input=${rej.tin} output=${rej.tout}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
