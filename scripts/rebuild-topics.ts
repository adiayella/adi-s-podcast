import "./env";
import { neon } from "@neondatabase/serverless";
import { selectTopics } from "@/nlp/topics";
import { PROMPT_VERSION } from "@/nlp/taxonomy";

// Re-derives episode_topics from the stored model output using the current selection rule.
// No Gemini calls. usage: npm run rebuild-topics
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const jobs = await sql`select episode_id, raw_output->'extraction'->'topics' as topics from analysis_jobs where status = 'done' and prompt_version = ${PROMPT_VERSION}`;
  const topicRows = await sql`select id, name from topics`;
  const idByName = new Map(topicRows.map((t) => [t.name as string, t.id as number]));
  let rows = 0;
  for (const j of jobs) {
    const kept = selectTopics((j.topics ?? []) as { topic: string; confidence: number }[]);
    await sql`delete from episode_topics where episode_id = ${j.episode_id}`;
    for (const t of kept) {
      const topicId = idByName.get(t.topic);
      if (!topicId) continue;
      await sql`insert into episode_topics (episode_id, topic_id, confidence, source) values (${j.episode_id}, ${topicId}, ${t.confidence}, 'metadata')`;
      rows++;
    }
  }
  console.log(`rebuilt topics for ${jobs.length} episodes, ${rows} episode-topic links`);
}
main().catch((e) => { console.error(e); process.exit(1); });
