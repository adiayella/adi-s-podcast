import "./env";
import { neon } from "@neondatabase/serverless";
import { GoogleGenAI } from "@google/genai";

// usage: npm run healthcheck [-- --base http://localhost:3000]
// Read-only: checks data integrity, integrations and (if a server is running) every page. Sends no email.
const sql = neon(process.env.DATABASE_URL!);
const base = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });

async function run(name: string, fn: () => Promise<[boolean, string?]>) {
  try {
    const [ok, detail] = await fn();
    check(name, ok, detail ?? "");
  } catch (e) {
    check(name, false, e instanceof Error ? e.message.slice(0, 160) : String(e));
  }
}

async function main() {
  // ---------------- database integrity
  await run("DB: all 16 tables + pgvector present", async () => {
    const t = await sql`select count(*)::int n from information_schema.tables where table_schema='public' and table_name not like '\\_\\_%'`;
    const v = await sql`select 1 from pg_extension where extname='vector'`;
    return [Number(t[0].n) >= 16 && v.length === 1, `${t[0].n} tables`];
  });
  await run("DB: no duplicate episodes (same show + title)", async () => {
    const r = await sql`select count(*)::int n from (select podcast_id, dedupe_key from episodes group by 1,2 having count(*)>1) d`;
    return [Number(r[0].n) === 0, `${r[0].n} duplicates`];
  });
  await run("DB: every episode has a source row", async () => {
    const r = await sql`select count(*)::int n from episodes e where not exists (select 1 from episode_sources s where s.episode_id=e.id)`;
    return [Number(r[0].n) === 0, `${r[0].n} without source`];
  });
  await run("DB: no orphaned appearances / evidence / topics", async () => {
    const r = await sql`select (select count(*) from guest_appearances a where not exists (select 1 from guests g where g.id=a.guest_id))::int
      + (select count(*) from sponsor_evidence s where not exists (select 1 from brands b where b.id=s.brand_id))::int
      + (select count(*) from episode_topics t where not exists (select 1 from topics x where x.id=t.topic_id))::int as n`;
    return [Number(r[0].n) === 0, `${r[0].n} orphans`];
  });
  await run("DB: monitored episodes all analysed (current prompt)", async () => {
    const r = await sql`select count(*)::int n from episodes e join podcasts p on p.id=e.podcast_id and p.enabled
      where not exists (select 1 from analysis_jobs j where j.episode_id=e.id and j.status='done' and j.prompt_version='v3')`;
    return [Number(r[0].n) === 0, `${r[0].n} episodes without a finished v3 analysis`];
  });
  await run("DB: no failed or stuck analysis jobs", async () => {
    const r = await sql`select count(*) filter (where status='failed')::int f, count(*) filter (where status='running')::int r from analysis_jobs`;
    return [Number(r[0].f) === 0 && Number(r[0].r) === 0, `failed ${r[0].f}, running ${r[0].r}`];
  });
  await run("DB: every sponsor label above 'unknown' has a quote", async () => {
    const r = await sql`select count(*)::int n from sponsor_evidence where classification <> 'unknown' and coalesce(evidence_quote,'')=''`;
    return [Number(r[0].n) === 0, `${r[0].n} without quote`];
  });
  await run("DB: guest appearances are unique per episode+guest", async () => {
    const r = await sql`select count(*)::int n from (select episode_id, guest_id from guest_appearances group by 1,2 having count(*)>1) d`;
    return [Number(r[0].n) === 0, `${r[0].n} duplicates`];
  });
  await run("DB: snapshots exist for this week, one per entity", async () => {
    const r = await sql`select count(*)::int n, (select count(*) from (select kind, entity_id, week_start from score_snapshots group by 1,2,3 having count(*)>1) d)::int dup from score_snapshots`;
    return [Number(r[0].n) > 0 && Number(r[0].dup) === 0, `${r[0].n} rows, ${r[0].dup} duplicates`];
  });
  await run("DB: monitored podcasts - sync health", async () => {
    const r = await sql`select count(*)::int total, count(*) filter (where last_sync_status='ok')::int ok, count(*) filter (where last_sync_status='error')::int err from podcasts where enabled`;
    return [Number(r[0].total) === 10 && Number(r[0].err) === 0, `${r[0].ok} ok, ${r[0].err} error of ${r[0].total} monitored`];
  });
  await run("DB: weekly brief stored for this week", async () => {
    const r = await sql`select email_status from weekly_reports order by week_start desc limit 1`;
    return [r.length === 1, r.length ? `latest status: ${r[0].email_status}` : "none"];
  });

  // ---------------- integrations
  await run("Neon: reachable", async () => [(await sql`select 1 as x`)[0].x === 1]);
  await run("YouTube API: key works", async () => {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&id=UCzwCEE_PchiBULMnAJqhGVg&key=${process.env.YOUTUBE_API_KEY}`);
    return [r.ok, `HTTP ${r.status}`];
  });
  await run("Gemini Flash: structured call works", async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const res = await ai.models.generateContent({ model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash", contents: 'Return JSON {"ok":true}', config: { responseMimeType: "application/json" } });
    return [JSON.parse(res.text ?? "{}").ok === true, process.env.GEMINI_MODEL ?? "gemini-3.5-flash"];
  });
  await run("Gemini embeddings: 768-dim request works", async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const res = await ai.models.embedContent({ model: "gemini-embedding-001", contents: "test", config: { outputDimensionality: 768 } });
    return [res.embeddings?.[0]?.values?.length === 768, `${res.embeddings?.[0]?.values?.length} dims`];
  });
  await run("Resend: API key accepted (no email sent)", async () => {
    const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
    // a send-only key answers 401 "restricted_api_key"; an invalid key answers 401 "invalid_api_key"
    const body = (await r.json().catch(() => ({}))) as { name?: string };
    return [r.ok || body.name === "restricted_api_key", `HTTP ${r.status}${body.name ? ` ${body.name}` : ""}`];
  });
  for (const k of ["DATABASE_URL", "YOUTUBE_API_KEY", "GEMINI_API_KEY", "RESEND_API_KEY", "BRIEF_TO_EMAIL", "CRON_SECRET", "ADMIN_PASSWORD"])
    check(`Env: ${k} set`, Boolean(process.env[k]));

  // ---------------- running app
  const up = await fetch(base).then((r) => r.ok).catch(() => false);
  check("App: server reachable", up, base);
  if (up) {
    const pages: [string, string][] = [["/", "Overview"], ["/guests", "Guest Radar"], ["/topics", "Topic Radar"], ["/sponsors", "Sponsor Radar"], ["/brief", "Weekly Intelligence Brief"], ["/podcasts", "Manage Podcasts"], ["/settings", "Data Sources"], ["/admin", "Admin"]];
    for (const [path, text] of pages) {
      await run(`Page ${path}`, async () => {
        const r = await fetch(base + path);
        const html = await r.text();
        return [r.ok && html.includes(text) && !/Application error|Internal Server Error/i.test(html), `HTTP ${r.status}`];
      });
    }
    await run("Cron: no token -> 401", async () => [(await fetch(`${base}/api/cron/daily`)).status === 401]);
    await run("Cron: wrong token -> 401", async () => [(await fetch(`${base}/api/cron/weekly`, { headers: { Authorization: "Bearer wrong" } })).status === 401]);
    await run("Admin: public podcast page offers no edit controls", async () => {
      const html = await (await fetch(`${base}/podcasts`)).text();
      return [!html.includes("Add a podcast") && html.includes("Read-only view"), "read-only for visitors"];
    });
  }

  const bad = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  - " + r.detail : ""}`);
  console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
  process.exit(bad.length ? 1 : 0);
}

main();
