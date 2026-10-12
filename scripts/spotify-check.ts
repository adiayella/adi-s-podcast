// Checks the Spotify Web API credentials in .env.local without printing them.
import "./env";

async function main() {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  console.log(`SPOTIFY_CLIENT_ID: ${id ? `set (${id.length} chars)` : "MISSING"}`);
  console.log(`SPOTIFY_CLIENT_SECRET: ${secret ? `set (${secret.length} chars)` : "MISSING"}`);
  if (!id || !secret) return;

  const tok = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
    body: "grant_type=client_credentials",
  });
  const tj = (await tok.json()) as { access_token?: string; error?: string; error_description?: string };
  console.log(`token: HTTP ${tok.status}${tj.error ? ` ${tj.error}: ${tj.error_description ?? ""}` : " ok"}`);
  if (!tj.access_token) return;

  const q = "Memory Explained Why We Forget Nikolay Kukushkin";
  const res = await fetch(`https://api.spotify.com/v1/search?${new URLSearchParams({ q, type: "episode", market: "IN", limit: "3" })}`, {
    headers: { Authorization: `Bearer ${tj.access_token}` },
  });
  const body = (await res.json()) as { episodes?: { items: ({ name: string; external_urls: { spotify: string }; release_date: string } | null)[] }; error?: unknown };
  console.log(`search: HTTP ${res.status}`);
  if (body.error) console.log(JSON.stringify(body.error));
  for (const e of body.episodes?.items ?? []) if (e) console.log(`- ${e.release_date}  ${e.name.slice(0, 80)}\n  ${e.external_urls.spotify}`);
}
main().then(() => process.exit(0), (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
