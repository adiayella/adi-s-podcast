import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { QuotaExceeded, setYoutubeMeter } from "@/services/youtube";

const { apiCache, apiUsage } = schema;

const todayUTC = () => new Date().toISOString().slice(0, 10);

/** Return a cached value if it is still fresh, otherwise compute, store and return it. Saves quota on repeat questions. */
export async function cached<T>(key: string, ttlHours: number, compute: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
  const [row] = await db.select().from(apiCache).where(and(eq(apiCache.key, key), gt(apiCache.expiresAt, new Date())));
  if (row) return { value: row.payload as T, hit: true };
  const value = await compute();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  await db
    .insert(apiCache)
    .values({ key, payload: value as object, expiresAt })
    .onConflictDoUpdate({ target: apiCache.key, set: { payload: value as object, fetchedAt: new Date(), expiresAt } });
  return { value, hit: false };
}

export async function cacheHas(key: string): Promise<boolean> {
  const [row] = await db.select({ key: apiCache.key }).from(apiCache).where(and(eq(apiCache.key, key), gt(apiCache.expiresAt, new Date())));
  return Boolean(row);
}

export async function unitsUsedToday(provider = "youtube"): Promise<number> {
  const [row] = await db.select().from(apiUsage).where(and(eq(apiUsage.day, todayUTC()), eq(apiUsage.provider, provider)));
  return row?.units ?? 0;
}

export async function recordUnits(units: number, provider = "youtube") {
  if (units <= 0) return;
  await db
    .insert(apiUsage)
    .values({ day: todayUTC(), provider, units })
    .onConflictDoUpdate({ target: [apiUsage.day, apiUsage.provider], set: { units: sql`${apiUsage.units} + ${units}` } });
}

/**
 * Run `fn` with a YouTube budget. The meter counts every call and throws QuotaExceeded once `limit` is spent;
 * the units actually used are saved to api_usage, even if the run stops early.
 */
export async function withYoutubeBudget<T>(limit: number, fn: (budget: { spent: () => number; remaining: () => number }) => Promise<T>): Promise<{ result: T | null; spent: number; stoppedByQuota: boolean }> {
  let spent = 0;
  setYoutubeMeter((units) => {
    if (spent + units > limit) throw new QuotaExceeded();
    spent += units;
  });
  let result: T | null = null;
  let stoppedByQuota = false;
  try {
    result = await fn({ spent: () => spent, remaining: () => limit - spent });
  } catch (e) {
    if (e instanceof QuotaExceeded) stoppedByQuota = true;
    else throw e;
  } finally {
    setYoutubeMeter(null);
    await recordUnits(spent);
  }
  return { result, spent, stoppedByQuota };
}
