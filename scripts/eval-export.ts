import "./env";
import { mkdirSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// Picks 4 episodes per monitored show (stable hash order) and prints a readable excerpt for labelling.
// Sponsor disclosures usually sit at the end of a description, so lines with promo cues are always shown.
const sql = neon(process.env.DATABASE_URL!);
const CUE = /sponsor|brought to you|presented by|partner|promo|code|discount|offer|https?:\/\/|download|checkout|check out|use my|use our/i;

async function main() {
  const rows = await sql`
    select * from (
      select e.id, p.name as podcast, e.title, e.description, e.published_at,
             row_number() over (partition by p.id order by md5(e.id::text)) rn
      from episodes e join podcasts p on p.id = e.podcast_id and p.enabled
    ) t where rn <= 4 order by podcast, rn`;
  mkdirSync("data/eval", { recursive: true });
  writeFileSync("data/eval/candidates.json", JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "rn"))), null, 1));
  for (const r of rows) {
    const d = String(r.description ?? "");
    const lines = d.split("\n").map((l) => l.trim()).filter(Boolean);
    const head = d.slice(0, 650).replace(/\s+/g, " ");
    const cues = lines.filter((l) => CUE.test(l)).map((l) => l.replace(/\s+/g, " ").slice(0, 170)).slice(0, 6);
    console.log(`\n#${r.id} | ${r.podcast} | ${r.title}\n  HEAD: ${head}${cues.length ? "\n  CUES: " + cues.join(" || ") : ""}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
