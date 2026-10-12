import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Extraction } from "@/nlp/schema";
import { PROMPT_VERSION } from "@/nlp/taxonomy";
import { decideBrand, decideGuest, nameKey, type BrandCandidate, type GuestCandidate } from "@/resolve/match";

const { guests, guestAliases, guestAppearances, brands, brandAliases, sponsorEvidence } = schema;

const STRENGTH: Record<string, number> = { explicit_sponsor: 4, paid_promotion: 3, possible_affiliate: 2, unknown: 1, organic_mention: 0 };

type JobRow = { episodeId: number; extraction: Extraction; paidFlag: boolean; timestamps: { guests?: Record<string, number>; sponsors?: Record<string, number> } | null };

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

export type ResolveSummary = {
  episodes: number;
  guestsCreated: number;
  guestsMerged: number;
  guestsAmbiguous: number;
  appearances: number;
  brandsCreated: number;
  brandsMerged: number;
  sponsorEvidence: number;
};

/** Turn raw model extractions into guest / brand entities. Safe to re-run: appearances and evidence are rebuilt per episode. */
export async function resolveAll(): Promise<ResolveSummary> {
  const jobs = await rows<JobRow>(sql`
    select j.episode_id as "episodeId", j.raw_output->'extraction' as extraction, j.raw_output->'timestamps' as timestamps,
           coalesce((select bool_or(s.paid_promotion) from episode_sources s where s.episode_id = j.episode_id), false) as "paidFlag"
    from analysis_jobs j join episodes e on e.id = j.episode_id
    where j.status = 'done' and j.stage = 'analyze' and j.prompt_version = ${PROMPT_VERSION}
    order by e.published_at asc, j.episode_id`);

  const summary: ResolveSummary = {
    episodes: jobs.length, guestsCreated: 0, guestsMerged: 0, guestsAmbiguous: 0, appearances: 0,
    brandsCreated: 0, brandsMerged: 0, sponsorEvidence: 0,
  };

  // ---- load existing entities into memory ----
  const guestRows = await db.select().from(guests);
  const guestAliasRows = await db.select().from(guestAliases);
  const guestCands = new Map<number, GuestCandidate & { category: string | null }>();
  for (const g of guestRows) guestCands.set(g.id, { id: g.id, aliases: [g.canonicalName], company: g.company ?? "", category: g.category });
  for (const a of guestAliasRows) guestCands.get(a.guestId)?.aliases.push(a.alias);

  const brandRows = await db.select().from(brands);
  const brandAliasRows = await db.select().from(brandAliases);
  const brandCands = new Map<number, BrandCandidate>();
  for (const b of brandRows) brandCands.set(b.id, { id: b.id, aliases: [b.canonicalName] });
  for (const a of brandAliasRows) brandCands.get(a.brandId)?.aliases.push(a.alias);

  const seenGuestAlias = new Set(guestAliasRows.map((a) => a.alias));
  const seenBrandAlias = new Set(brandAliasRows.map((a) => a.alias));

  const apps: (typeof guestAppearances.$inferInsert)[] = [];
  const evidence: (typeof sponsorEvidence.$inferInsert)[] = [];

  for (const job of jobs) {
    const x = job.extraction;

    // ---- guests ----
    const seenInEpisode = new Set<number>();
    for (const g of x.guests) {
      const decision = decideGuest(g.name, g.company, [...guestCands.values()]);
      let id: number;
      if (decision.kind === "exact" || decision.kind === "merge") {
        id = decision.id;
        if (decision.kind === "merge") summary.guestsMerged++;
      } else {
        const ambiguous = decision.kind === "ambiguous";
        const [row] = await db
          .insert(guests)
          .values({ canonicalName: g.name, company: g.company || null, role: g.role || null, category: g.category, needsReview: ambiguous })
          .returning({ id: guests.id });
        id = row.id;
        guestCands.set(id, { id, aliases: [g.name], company: g.company, category: g.category });
        summary.guestsCreated++;
        if (ambiguous) summary.guestsAmbiguous++;
      }
      const cand = guestCands.get(id)!;
      const aliasKey = nameKey(g.name);
      if (!cand.aliases.some((a) => nameKey(a) === aliasKey)) {
        cand.aliases.push(g.name);
        if (!seenGuestAlias.has(g.name)) {
          await db.insert(guestAliases).values({ guestId: id, alias: g.name }).onConflictDoNothing();
          seenGuestAlias.add(g.name);
        }
      }
      // fill in details we did not know before
      if (g.company && !cand.company) {
        cand.company = g.company;
        await db.update(guests).set({ company: g.company, role: g.role || null }).where(eq(guests.id, id));
      }
      if (seenInEpisode.has(id)) continue;
      seenInEpisode.add(id);
      // evidence found in a transcript carries the time it was said; everything else stays metadata-level
      const at = job.timestamps?.guests?.[g.name];
      apps.push({ episodeId: job.episodeId, guestId: id, confidence: g.confidence, source: at !== undefined ? "transcript" : "metadata", evidenceText: g.evidence || null, evidenceSeconds: at !== undefined ? Math.round(at) : null });
    }

    // ---- sponsors: one row per (episode, brand), strongest label wins ----
    const best = new Map<number, (typeof sponsorEvidence.$inferInsert)>();
    for (const s of x.sponsors) {
      if (s.classification === "organic_mention") continue;
      const decision = decideBrand(s.brand, [...brandCands.values()]);
      let id: number;
      if (decision.kind === "exact" || decision.kind === "merge") {
        id = decision.id;
        if (decision.kind === "merge") summary.brandsMerged++;
      } else {
        const [row] = await db
          .insert(brands)
          .values({ canonicalName: s.brand, category: s.category || null, needsReview: decision.kind === "ambiguous" })
          .returning({ id: brands.id });
        id = row.id;
        brandCands.set(id, { id, aliases: [s.brand] });
        summary.brandsCreated++;
      }
      const cand = brandCands.get(id)!;
      if (!cand.aliases.some((a) => a.toLowerCase() === s.brand.toLowerCase())) {
        cand.aliases.push(s.brand);
        if (!seenBrandAlias.has(s.brand)) {
          await db.insert(brandAliases).values({ brandId: id, alias: s.brand }).onConflictDoNothing();
          seenBrandAlias.add(s.brand);
        }
      }
      const at = job.timestamps?.sponsors?.[s.brand];
      const row = { episodeId: job.episodeId, brandId: id, classification: s.classification, evidenceQuote: s.evidence, confidence: s.confidence, source: at !== undefined ? ("transcript" as const) : ("metadata" as const), platformPaidFlag: job.paidFlag, evidenceSeconds: at !== undefined ? Math.round(at) : null };
      const prev = best.get(id);
      if (!prev || STRENGTH[row.classification] > STRENGTH[prev.classification]) best.set(id, row);
    }
    evidence.push(...best.values());
  }

  // ---- replace derived rows for the processed episodes ----
  const episodeIds = jobs.map((j) => j.episodeId);
  for (let i = 0; i < episodeIds.length; i += 100) {
    const chunk = episodeIds.slice(i, i + 100);
    await db.delete(guestAppearances).where(inArray(guestAppearances.episodeId, chunk));
    await db.delete(sponsorEvidence).where(inArray(sponsorEvidence.episodeId, chunk));
  }
  for (let i = 0; i < apps.length; i += 200) await db.insert(guestAppearances).values(apps.slice(i, i + 200)).onConflictDoNothing();
  for (let i = 0; i < evidence.length; i += 200) await db.insert(sponsorEvidence).values(evidence.slice(i, i + 200)).onConflictDoNothing();
  summary.appearances = apps.length;
  summary.sponsorEvidence = evidence.length;
  return summary;
}
