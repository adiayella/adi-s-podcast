// Checks the Tavily key in .env.local without printing it, using raw results only (no Tavily-generated answer).
import "./env";

async function main() {
  const key = process.env.TAVILY_API_KEY?.trim();
  console.log(`TAVILY_API_KEY: ${key ? `set (${key.length} chars${key.startsWith("tvly-") ? ", tvly- prefix ok" : ", does NOT start with tvly-"})` : "MISSING"}`);
  if (!key) return;
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: "sports startup India", search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false, include_images: false }),
  });
  const j = (await res.json()) as { results?: { title: string; url: string; content: string; score: number; published_date?: string }[]; answer?: unknown; detail?: unknown; response_time?: number; usage?: unknown };
  console.log(`search: HTTP ${res.status}${j.detail ? ` ${JSON.stringify(j.detail)}` : ""} · ${j.response_time ?? "?"}s · answer included: ${j.answer ? "yes" : "no"}`);
  console.log("result keys:", j.results?.[0] ? Object.keys(j.results[0]).join(",") : "-", "| usage:", JSON.stringify(j.usage ?? null));
  for (const r of j.results ?? []) console.log(`- ${r.score?.toFixed(2)} ${r.title.slice(0, 80)}\n  ${r.url}`);
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
