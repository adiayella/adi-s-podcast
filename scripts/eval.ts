import "./env";
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { extractEpisode } from "@/nlp/extract";
import { addMatch, emptyCounts, matchItems, prf, sameBrand, sameName } from "@/eval/metrics";
import { PROMPT_VERSION } from "@/nlp/taxonomy";
import { selectTopics } from "@/nlp/topics";
import { mergeDescriptions } from "@/nlp/text";

// usage: npm run eval
// Runs the extractor fresh on every gold-labelled episode and scores it. Nothing is written to the DB.
type Gold = {
  id: number;
  type: string;
  guests: string[] | null;
  topics: string[] | null;
  sponsors: { brand: string; classification: string }[];
};

const sql = neon(process.env.DATABASE_URL!);
const gold: Gold[] = JSON.parse(readFileSync("data/eval/gold.json", "utf8")).episodes;
const CONFIRMED = new Set(["explicit_sponsor", "paid_promotion"]);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const rows = await sql`
    select e.id, e.title, e.description, e.published_at, p.name podcast,
      (select string_agg(s.description, chr(10)) from episode_sources s where s.episode_id = e.id and s.kind = 'youtube') as yt
    from episodes e join podcasts p on p.id = e.podcast_id where e.id = any(${gold.map((g) => g.id)})`;
  const byId = new Map(rows.map((r) => [Number(r.id), r]));

  const guests = emptyCounts();
  const topics = emptyCounts();
  const sponsors = emptyCounts();
  let typeOk = 0;
  let typeN = 0;
  let classOk = 0;
  let classN = 0;
  let falseConfirmed = 0;
  const errors: string[] = [];
  const perEpisode: unknown[] = [];

  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < gold.length) {
        const g = gold[next++];
        const ep = byId.get(g.id);
        if (!ep) {
          errors.push(`#${g.id}: episode not found`);
          continue;
        }
        const r = await extractEpisode({
          podcast: ep.podcast,
          title: ep.title,
          description: mergeDescriptions(ep.description ?? "", ep.yt),
          publishedAt: new Date(ep.published_at).toISOString().slice(0, 10),
        });
        const x = r.extraction;

        typeN++;
        if (x.episodeType === g.type) typeOk++;
        else errors.push(`#${g.id} TYPE: predicted ${x.episodeType}, gold ${g.type} (${ep.title.slice(0, 50)})`);

        if (g.guests) {
          const m = matchItems(x.guests, g.guests, (p, gn) => sameName(p.name, gn));
          addMatch(guests, m);
          for (const e of m.extra) errors.push(`#${g.id} GUEST false positive: ${e.name} (${e.category}) in "${ep.title.slice(0, 50)}"`);
          for (const e of m.missed) errors.push(`#${g.id} GUEST missed: ${e}`);
        }
        if (g.topics) {
          const m = matchItems(selectTopics(x.topics), g.topics, (p, gt) => p.topic === gt);
          addMatch(topics, m);
          for (const e of m.extra) errors.push(`#${g.id} TOPIC extra: ${e.topic}`);
          for (const e of m.missed) errors.push(`#${g.id} TOPIC missed: ${e}`);
        }
        const sm = matchItems(x.sponsors, g.sponsors, (p, gs) => sameBrand(p.brand, gs.brand));
        addMatch(sponsors, sm);
        for (const { p, g: gs } of sm.pairs) {
          classN++;
          if (p.classification === gs.classification) classOk++;
          else errors.push(`#${g.id} SPONSOR class: ${p.brand} predicted ${p.classification}, gold ${gs.classification}`);
          if (CONFIRMED.has(p.classification) && !CONFIRMED.has(gs.classification)) falseConfirmed++;
        }
        for (const e of sm.extra) {
          errors.push(`#${g.id} SPONSOR false positive: ${e.brand} [${e.classification}] "${e.evidence.slice(0, 70)}"`);
          if (CONFIRMED.has(e.classification)) falseConfirmed++;
        }
        for (const e of sm.missed) errors.push(`#${g.id} SPONSOR missed: ${e.brand}`);
        perEpisode.push({ id: g.id, predicted: x });
      }
    }),
  );

  const report = {
    promptVersion: PROMPT_VERSION,
    episodes: gold.length,
    goldStatus: JSON.parse(readFileSync("data/eval/gold.json", "utf8")).status,
    guests: { ...guests, ...prf(guests) },
    topics: { ...topics, ...prf(topics) },
    sponsors: { ...sponsors, ...prf(sponsors) },
    sponsorClassificationAccuracy: classN ? classOk / classN : null,
    falseConfirmedSponsors: falseConfirmed,
    episodeTypeAccuracy: typeN ? typeOk / typeN : null,
  };
  writeFileSync("data/eval/last-report.json", JSON.stringify({ report, errors, perEpisode }, null, 1));

  console.log(`\nNLP EVALUATION  (prompt ${PROMPT_VERSION}, ${gold.length} episodes, gold status: ${report.goldStatus})\n`);
  for (const k of ["guests", "topics", "sponsors"] as const) {
    const r = report[k];
    console.log(`${k.padEnd(9)} precision ${pct(r.precision)}  recall ${pct(r.recall)}  F1 ${pct(r.f1)}   (tp ${r.tp}, fp ${r.fp}, fn ${r.fn})`);
  }
  console.log(`sponsor classification accuracy (on matched brands): ${report.sponsorClassificationAccuracy === null ? "n/a" : pct(report.sponsorClassificationAccuracy)}`);
  console.log(`false CONFIRMED sponsors (explicit/paid when gold says otherwise): ${falseConfirmed}`);
  console.log(`episode type accuracy: ${pct(report.episodeTypeAccuracy ?? 0)}`);
  console.log(`\nERRORS TO REVIEW (${errors.length}):`);
  for (const e of errors.sort()) console.log("  " + e);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
