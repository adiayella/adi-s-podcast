import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// Read-only dashboards are public. Anything that changes data (podcast list, generating or sending a
// brief) needs the admin password from ADMIN_PASSWORD. The cookie holds an HMAC of a fixed label keyed by
// that password, so it cannot be forged without knowing the password and dies when the password changes.
const COOKIE = "radar_admin";
const MAX_AGE = 60 * 60 * 24 * 7;

function secret(): string | null {
  return process.env.ADMIN_PASSWORD || null;
}

function token(pw: string): string {
  return createHmac("sha256", pw).update("podcast-radar-admin-v1").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Without ADMIN_PASSWORD, admin is open in local development and closed in production. */
export function adminConfigured(): boolean {
  return secret() !== null;
}

export async function isAdmin(): Promise<boolean> {
  const pw = secret();
  if (!pw) return process.env.NODE_ENV !== "production";
  const value = (await cookies()).get(COOKIE)?.value;
  return Boolean(value) && safeEqual(value!, token(pw));
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new Error("Admin login required");
}

export async function loginWithPassword(input: string): Promise<boolean> {
  const pw = secret();
  if (!pw || !safeEqual(createHmac("sha256", "cmp").update(input).digest("hex"), createHmac("sha256", "cmp").update(pw).digest("hex"))) return false;
  (await cookies()).set(COOKIE, token(pw), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: MAX_AGE, path: "/" });
  return true;
}

export async function logout(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
