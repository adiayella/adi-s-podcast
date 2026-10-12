import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { generateJson, GEMINI_MODEL } from "@/lib/gemini";
import { buildOutreachContent, checkDraft, draftJsonSchema, draftSchema, OUTREACH_PROMPT_VERSION, SYSTEM_INSTRUCTION, validateContact, type OutreachEvidence } from "@/nlp/outreach";
import { topAudienceThemes } from "@/services/audience";
import { latestOpportunities } from "@/services/intelligence";

// COPY-ONLY OUTREACH. Nothing in this file sends an email. There is deliberately no send function, no mail client import,
// and no scheduled step that contacts anyone outside the founder. Drafts are text for the founder to review, edit, copy
// and approve; approval is a recorded status, not a delivery.

type Kind = "guest" | "brand";
async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

// ---------------------------------------------------------------- sender identity (founder-entered)
export async function getSender(): Promise<{ name: string; podcast: string }> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, "outreachSender"));
  const v = (row?.value ?? {}) as { name?: string; podcast?: string };
  return { name: v.name?.trim() || "Aditya", podcast: v.podcast?.trim() || "[your podcast name]" };
}
export async function saveSender(name: string, podcast: string) {
  const value = { name: name.trim().slice(0, 80), podcast: podcast.trim().slice(0, 120) };
  const now = new Date();
  await db.insert(schema.settings).values({ key: "outreachSender", value, updatedAt: now }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } });
}

// ---------------------------------------------------------------- contact routes (manual only)
export async function listContacts(kind: Kind, id: number) {
  return db.select().from(schema.contactRoutes).where(and(eq(schema.contactRoutes.entityKind, kind), eq(schema.contactRoutes.entityId, id))).orderBy(schema.contactRoutes.id);
}
export async function addContact(input: { kind: Kind; id: number; type: string; value: string; sourceUrl?: string; verified: boolean; note?: string }) {
  const v = validateContact(input.type, input.value);
  if (!v.ok) return { ok: false as const, error: v.error };
  let sourceUrl: string | null = null;
  if (input.sourceUrl?.trim()) {
    const s = validateContact("website", input.sourceUrl);
    if (!s.ok) return { ok: false as const, error: "The source link is not a valid web address." };
    sourceUrl = s.value;
  }
  await db.insert(schema.contactRoutes).values({ entityKind: input.kind, entityId: input.id, kind: input.type, value: v.value, sourceUrl, verified: input.verified, note: input.note?.trim().slice(0, 200) || null });
  return { ok: true as const };
}
export async function deleteContact(id: number) {
  await db.delete(schema.contactRoutes).where(eq(schema.contactRoutes.id, id));
}

// ---------------------------------------------------------------- evidence
/** The only facts a draft may use, all read from our own database. Returns an error string when outreach is not justified. */
export async function buildEvidence(kind: Kind, id: number): Promise<OutreachEvidence | { error: string }> {
  const sender = await getSender();
  const asks = (await topAudienceThemes(6)).filter((t) => t.kind !== "concern").slice(0, 2).map((t) => t.label);
  if (kind === "guest") {
    const [g] = await db.select().from(schema.guests).where(eq(schema.guests.id, id));
    if (!g) return { error: "Guest not found" };
    const eps = await rows<{ id: number; title: string; podcast: string; at: string; url: string | null; quote: string | null }>(sql`
      select e.id, e.title, p.name as podcast, e.published_at as at, e.url, ga.evidence_text as quote
      from guest_appearances ga join episodes e on e.id = ga.episode_id join podcasts p on p.id = e.podcast_id
      where ga.guest_id = ${id} order by e.published_at desc limit 3`);
    if (!eps.length) return { error: "No appearances on record for this guest" };
    const topics = await rows<{ name: string }>(sql`select distinct t.name from episode_topics et join topics t on t.id = et.topic_id where et.episode_id in (${sql.join(eps.map((e) => sql`${e.id}`), sql`, `)}) limit 4`);
    return { kind, name: g.canonicalName, role: g.role, company: g.company, episodes: eps.map((e) => ({ title: e.title, podcast: e.podcast, date: String(e.at).slice(0, 10), url: e.url, quote: e.quote })), topics: topics.map((t) => t.name), audienceAsks: asks, sender };
  }
  const [b] = await db.select().from(schema.brands).where(eq(schema.brands.id, id));
  if (!b) return { error: "Brand not found" };
  const eps = await rows<{ title: string; podcast: string; at: string; url: string | null; quote: string | null }>(sql`
    select e.title, p.name as podcast, e.published_at as at, e.url, se.evidence_quote as quote
    from sponsor_evidence se join episodes e on e.id = se.episode_id join podcasts p on p.id = e.podcast_id
    where se.brand_id = ${id} and se.classification in ('explicit_sponsor', 'paid_promotion') order by e.published_at desc limit 3`);
  if (!eps.length) return { error: "No verified sponsorship disclosure for this brand. Drafts are only written for disclosed sponsors, never for promo links alone." };
  return { kind, name: b.canonicalName, company: b.canonicalName, episodes: eps.map((e) => ({ title: e.title, podcast: e.podcast, date: String(e.at).slice(0, 10), url: e.url, quote: e.quote })), topics: [], brandCategory: b.category, audienceAsks: asks, sender };
}

// ---------------------------------------------------------------- drafts
export type DraftRow = typeof schema.outreachDrafts.$inferSelect;

/** Write a new draft with Gemini, check it with code, store it. Earlier live drafts for the same target become "superseded". */
export async function generateDraft(kind: Kind, id: number): Promise<{ ok: true; draft: DraftRow } | { ok: false; error: string }> {
  const evidence = await buildEvidence(kind, id);
  if ("error" in evidence) return { ok: false, error: evidence.error };
  let feedback = "";
  let parsed: { subject: string; body: string } | null = null;
  let check = { ok: false, warnings: [] as string[] };
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await generateJson({ system: SYSTEM_INSTRUCTION, content: buildOutreachContent(evidence) + feedback, jsonSchema: draftJsonSchema });
    parsed = draftSchema.parse(JSON.parse(res.text));
    check = checkDraft(parsed, evidence);
    if (check.ok) break;
    feedback = `\n\nYour previous draft was rejected: ${check.warnings.join(" ")} Write it again without those problems.`;
  }
  if (!parsed) return { ok: false, error: "No draft was produced" };
  await db.update(schema.outreachDrafts).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(schema.outreachDrafts.entityKind, kind), eq(schema.outreachDrafts.entityId, id), inArray(schema.outreachDrafts.status, ["draft", "approved"])));
  const [draft] = await db.insert(schema.outreachDrafts).values({ entityKind: kind, entityId: id, status: "draft", subject: parsed.subject.trim(), body: parsed.body.trim(), evidence, warnings: check.warnings, model: GEMINI_MODEL, promptVersion: OUTREACH_PROMPT_VERSION }).returning();
  return { ok: true, draft };
}

export async function getLiveDraft(kind: Kind, id: number): Promise<DraftRow | null> {
  const [d] = await db.select().from(schema.outreachDrafts).where(and(eq(schema.outreachDrafts.entityKind, kind), eq(schema.outreachDrafts.entityId, id), ne(schema.outreachDrafts.status, "superseded"))).orderBy(desc(schema.outreachDrafts.id)).limit(1);
  return d ?? null;
}

/** Founder edits. An edit always sends an approved draft back to "draft": what was approved is no longer what is on screen. */
export async function updateDraft(id: number, subject: string, body: string): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
  const [d] = await db.select().from(schema.outreachDrafts).where(eq(schema.outreachDrafts.id, id));
  if (!d) return { ok: false, error: "Draft not found" };
  if (d.status === "superseded") return { ok: false, error: "This draft was replaced by a newer one" };
  const s = subject.trim();
  const b = body.trim();
  if (s.length < 3 || b.length < 20) return { ok: false, error: "Subject and body cannot be empty" };
  const check = checkDraft({ subject: s, body: b }, d.evidence as OutreachEvidence);
  await db.update(schema.outreachDrafts).set({ subject: s.slice(0, 200), body: b.slice(0, 4000), edited: true, status: "draft", approvedAt: null, warnings: check.warnings, updatedAt: new Date() }).where(eq(schema.outreachDrafts.id, id));
  return { ok: true, warnings: check.warnings };
}

/** Approval records the founder's sign-off. It is blocked while the safety check finds an address, phone number or unsupplied link. It sends nothing. */
export async function approveDraft(id: number): Promise<{ ok: boolean; error?: string }> {
  const [d] = await db.select().from(schema.outreachDrafts).where(eq(schema.outreachDrafts.id, id));
  if (!d) return { ok: false, error: "Draft not found" };
  if (d.status !== "draft") return { ok: false, error: `Only a draft can be approved (this one is ${d.status})` };
  const check = checkDraft({ subject: d.subject, body: d.body }, d.evidence as OutreachEvidence);
  if (!check.ok) return { ok: false, error: `Cannot approve: ${check.warnings[0]}` };
  await db.update(schema.outreachDrafts).set({ status: "approved", approvedAt: new Date(), warnings: check.warnings, updatedAt: new Date() }).where(eq(schema.outreachDrafts.id, id));
  return { ok: true };
}

export async function rejectDraft(id: number) {
  await db.update(schema.outreachDrafts).set({ status: "rejected", approvedAt: null, updatedAt: new Date() }).where(and(eq(schema.outreachDrafts.id, id), inArray(schema.outreachDrafts.status, ["draft", "approved"])));
}

// ---------------------------------------------------------------- the outreach list
export type Target = { kind: Kind; id: number; name: string; company: string | null; score: number; level: string; reasons: string[]; contacts: Awaited<ReturnType<typeof listContacts>>; draft: DraftRow | null; blocked: string | null };

/** Who is worth contacting: the top-scored guests, and only sponsors with a verified disclosure, with their contacts and live draft. */
export async function listTargets(opts: { guests?: number; sponsors?: number } = {}): Promise<Target[]> {
  const [g, s] = await Promise.all([latestOpportunities("guest", opts.guests ?? 8), latestOpportunities("sponsor", 12)]);
  // Each target needs a few small queries; running them side by side keeps the page fast (they were sequential).
  const [guests, brands] = await Promise.all([Promise.all(g.map((o) => toTarget("guest", o))), Promise.all(s.map((o) => toTarget("brand", o)))]);
  // promo-link-only brands are not outreach targets
  return [...guests, ...brands.filter((t) => !t.blocked).slice(0, opts.sponsors ?? 4)];
}
async function toTarget(kind: Kind, o: Awaited<ReturnType<typeof latestOpportunities>>[number]): Promise<Target> {
  const [ev, contacts, draft] = await Promise.all([kind === "brand" ? buildEvidence("brand", o.entity_id) : null, listContacts(kind, o.entity_id), getLiveDraft(kind, o.entity_id)]);
  return {
    kind,
    id: o.entity_id,
    name: o.name,
    company: o.company,
    score: Number(o.score),
    level: o.confidence.level,
    reasons: o.criteria.filter((c) => c.value !== null && c.value >= 0.5).slice(0, 3).map((c) => `${c.label}: ${c.note}`),
    contacts,
    draft,
    blocked: ev && "error" in ev ? ev.error : null,
  };
}

/**
 * Make sure this week's top targets have a draft to put in the Monday brief. Writes drafts only (text stored in our own
 * database); it contacts no one. A failure on one target is recorded and does not stop the others.
 */
export async function ensureDrafts(opts: { guests?: number; sponsors?: number } = {}) {
  const out = { written: 0, kept: 0, failed: [] as string[] };
  for (const t of await listTargets({ guests: opts.guests ?? 3, sponsors: opts.sponsors ?? 1 })) {
    if (t.draft && t.draft.status !== "rejected") {
      out.kept++;
      continue;
    }
    try {
      const r = await generateDraft(t.kind, t.id);
      if (r.ok) out.written++;
      else out.failed.push(`${t.name}: ${r.error.slice(0, 80)}`);
    } catch (e) {
      out.failed.push(`${t.name}: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
    }
  }
  return out;
}
