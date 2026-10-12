// The server fetches URLs that come from untrusted places (feeds, forms). Refuse non-web and internal addresses.
// This blocks the obvious cases; it does not defend against DNS rebinding.
export function isPublicHttpUrl(v: string, httpsOnly = false): boolean {
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" && (httpsOnly || u.protocol !== "http:")) return false;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/.test(h)) return false;
    return true;
  } catch {
    return false;
  }
}
