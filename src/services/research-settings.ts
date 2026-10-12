import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { DEFAULT_CONFIG, parseConfig, researchConfigSchema, type ResearchConfig } from "@/research/config";

const { researchSettingsVersions } = schema;

export type ActiveConfig = { version: number; config: ResearchConfig; createdAt: Date; note: string | null };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The active preferences: the highest saved version. The first call seeds version 1 with the defaults. */
export async function getActiveConfig(): Promise<ActiveConfig> {
  const [row] = await db.select().from(researchSettingsVersions).orderBy(desc(researchSettingsVersions.version)).limit(1);
  if (row) return { version: row.version, config: parseConfig(row.config), createdAt: row.createdAt, note: row.note };
  const [created] = await db
    .insert(researchSettingsVersions)
    .values({ version: 1, config: DEFAULT_CONFIG, note: "Default settings" })
    .onConflictDoNothing()
    .returning();
  if (created) return { version: 1, config: DEFAULT_CONFIG, createdAt: created.createdAt, note: created.note };
  return getActiveConfig(); // another request seeded it first
}

export type SaveResult = { ok: true; version: number; changed: boolean } | { ok: false; error: string };

/** Validate and save as a NEW version. Saving unchanged settings does not create a version. */
export async function saveConfig(input: unknown, note?: string): Promise<SaveResult> {
  const parsed = researchConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const active = await getActiveConfig();
  if (same(parsed.data, active.config)) return { ok: true, version: active.version, changed: false };
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = (await getActiveConfig()).version;
    const inserted = await db
      .insert(researchSettingsVersions)
      .values({ version: latest + 1, config: parsed.data, note: note ?? null })
      .onConflictDoNothing()
      .returning({ version: researchSettingsVersions.version });
    if (inserted.length) return { ok: true, version: inserted[0].version, changed: true };
  }
  return { ok: false, error: "Could not save settings, please try again" };
}

export async function listVersions(limit = 8) {
  return db.select().from(researchSettingsVersions).orderBy(desc(researchSettingsVersions.version)).limit(limit);
}

/** Restoring creates a new version that copies an old one, so history is never rewritten. */
export async function restoreVersion(version: number): Promise<SaveResult> {
  const [row] = await db.select().from(researchSettingsVersions).where(eq(researchSettingsVersions.version, version));
  if (!row) return { ok: false, error: `Version ${version} does not exist` };
  return saveConfig(parseConfig(row.config), `Restored from version ${version}`);
}
