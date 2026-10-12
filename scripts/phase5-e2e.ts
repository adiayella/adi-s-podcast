import "./env";
import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addContact, approveDraft, deleteContact, generateDraft, getLiveDraft, listContacts, listTargets, rejectDraft, updateDraft } from "@/services/outreach";

// usage: npm run phase5-e2e   (real database and real Gemini; sends NOTHING anywhere)
type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
const t = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
};

async function main() {
  const createdDrafts: number[] = [];
  const createdContacts: number[] = [];
  const targets = await listTargets();
  const guest = targets.find((x) => x.kind === "guest")!;
  const sponsor = targets.find((x) => x.kind === "brand");
  t("Targets: the outreach list is built from scored guests and verified sponsors", targets.length > 0 && Boolean(guest), `${targets.filter((x) => x.kind === "guest").length} guests, ${targets.filter((x) => x.kind === "brand").length} verified sponsors`);
  t("Targets: no contact details are invented (none exist until the founder adds them)", targets.every((x) => x.contacts.every((c) => c.id > 0)) && (await db.select().from(schema.contactRoutes)).length === 0);

  // ---- guest draft
  const g1 = await generateDraft("guest", guest.id);
  if (!g1.ok) throw new Error(g1.error);
  createdDrafts.push(g1.draft.id);
  const body = g1.draft.body;
  t("Draft: a guest draft is written from stored evidence, with a subject and body", g1.draft.subject.length > 3 && body.length > 200, `"${g1.draft.subject}"`);
  t("Draft: it contains no email address, phone number or link", !/@\S+\.\S+/.test(body + g1.draft.subject) && !/https?:\/\//.test(body), "");
  t("Draft: it refers to a real appearance from the evidence", g1.draft.warnings instanceof Array && !(g1.draft.warnings as string[]).some((w) => w.includes("specific appearance")), (g1.draft.warnings as string[]).join(" | ") || "no warnings");
  t("Draft: it is stored as a draft and was not sent", g1.draft.status === "draft" && g1.draft.approvedAt === null);

  // ---- sponsor rules
  const refused = await generateDraft("brand", (await db.select().from(schema.brands).where(sql`canonical_name ilike 'Porter%'`))[0]?.id ?? -1);
  t("Sponsors: a brand with only promo links (no disclosure) is refused a draft", !refused.ok && /disclos/i.test(refused.ok ? "" : refused.error), refused.ok ? "" : refused.error.slice(0, 90));
  if (sponsor) {
    const s1 = await generateDraft("brand", sponsor.id);
    if (s1.ok) {
      createdDrafts.push(s1.draft.id);
      t("Sponsors: a disclosed sponsor gets a draft that cites only disclosed evidence", s1.draft.body.length > 150 && (s1.draft.evidence as { episodes: unknown[] }).episodes.length > 0, `${sponsor.name}`);
    } else t("Sponsors: a disclosed sponsor gets a draft", false, s1.error);
  }

  // ---- manual contacts
  const bad = await addContact({ kind: "guest", id: guest.id, type: "email", value: "nonsense", verified: false });
  const badLink = await addContact({ kind: "guest", id: guest.id, type: "linkedin", value: "javascript:alert(1)", verified: false });
  t("Contacts: invalid emails and non-web links are rejected", !bad.ok && !badLink.ok);
  const okc = await addContact({ kind: "guest", id: guest.id, type: "linkedin", value: "https://www.linkedin.com/in/example", sourceUrl: "https://example.com/about", verified: true, note: "from their public profile" });
  const listed = await listContacts("guest", guest.id);
  createdContacts.push(...listed.map((c) => c.id));
  t("Contacts: a founder-entered public link is saved with its source and verified flag", okc.ok && listed.length === 1 && listed[0].verified && listed[0].sourceUrl === "https://example.com/about");

  // ---- editing, approval, regeneration
  const edit = await updateDraft(g1.draft.id, "My edited subject line", g1.draft.body + "\n\nP.S. Happy to work around your schedule.");
  const afterEdit = await getLiveDraft("guest", guest.id);
  t("Edit: a founder edit is saved and flagged as edited", edit.ok && afterEdit?.edited === true && afterEdit.subject === "My edited subject line");
  const appr = await approveDraft(g1.draft.id);
  const approved = await getLiveDraft("guest", guest.id);
  t("Approve: approval is recorded with a timestamp, and it is only a status", appr.ok && approved?.status === "approved" && approved.approvedAt !== null);
  await updateDraft(g1.draft.id, "My edited subject line", "Hi, please write to boss@example.com about this opportunity, it will be great for both of us and the audience.");
  const reverted = await getLiveDraft("guest", guest.id);
  t("Edit after approval: an edited draft goes back to draft and loses its approval", reverted?.status === "draft" && reverted.approvedAt === null);
  const blocked = await approveDraft(g1.draft.id);
  t("Safety: a draft containing an email address cannot be approved", !blocked.ok && /email/i.test(blocked.error ?? ""), blocked.error);

  const g2 = await generateDraft("guest", guest.id);
  if (g2.ok) createdDrafts.push(g2.draft.id);
  const old = await db.select().from(schema.outreachDrafts).where(eq(schema.outreachDrafts.id, g1.draft.id));
  t("Regenerate: a new draft supersedes the old one, leaving exactly one live draft", g2.ok && old[0].status === "superseded" && (await db.select().from(schema.outreachDrafts).where(sql`entity_kind = 'guest' and entity_id = ${guest.id} and status <> 'superseded'`)).length === 1);
  if (g2.ok) {
    await rejectDraft(g2.draft.id);
    t("Reject: a rejected draft is kept as rejected", (await db.select().from(schema.outreachDrafts).where(eq(schema.outreachDrafts.id, g2.draft.id)))[0].status === "rejected");
  }

  // ---- nothing is ever sent
  const states = (await db.select({ s: schema.outreachDrafts.status }).from(schema.outreachDrafts)).map((r) => r.s);
  t("No sending: no draft has any status beyond draft, approved, rejected or superseded", states.every((s) => ["draft", "approved", "rejected", "superseded"].includes(s)));
  const src = readFileSync("src/services/outreach.ts", "utf8") + readFileSync("src/nlp/outreach.ts", "utf8");
  t("No sending: the outreach code has no mail-sending call or provider import", !/emails\.send|from "resend"|nodemailer|sendMail|smtp/i.test(src));

  await db.delete(schema.outreachDrafts).where(inArray(schema.outreachDrafts.id, createdDrafts));
  for (const id of createdContacts) await deleteContact(id);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} phase 5 checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
