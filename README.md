# Adi's Podcast Radar

Weekly podcast ecosystem intelligence for the host of an Indian founders podcast: which guests, topics, sponsors
and sectors are moving across the shows he follows, with the evidence behind every claim, and a brief emailed every
Monday at about 07:00 IST.

Built for the MESA Cohort C4 final exam ("AI and its Applications", Podcast Ecosystem Radar).
All AI runs on **Gemini Flash**; all data is live from public sources.

## What it does

| Area | What you get |
|---|---|
| Overview | Topic heatmap, guest timeline with YouTube thumbnails, sponsor table, sector explorer, engagement, outreach suggestions |
| Guests / Topics / Sponsors | Ranked radars; each score shows its reasons and the episodes it came from |
| Sector Intelligence | Topic momentum and YouTube engagement, plus a Spotify trend scan for 20 sectors (artwork, scores, rubric breakdown) |
| Audience Questions | What YouTube commenters ask, kept separate from the AI's interpretation |
| Search | What the radar's own episodes say (Gemini-ranked, with reasons), this month's web news (Tavily), live Spotify results |
| Research Center | Focused research on the watchlist and discovery of new shows, with versioned settings |
| Outreach | Gemini drafts for guest and sponsor outreach. **Copy only: nothing is ever sent.** Contacts are entered by hand |
| Scoring Rubrics | Versioned guest and sponsor rubrics, and the written rules behind every "trending" label |
| Weekly Brief | Monday email for the previous Mon-Sun IST week, with separate generation / send / delivery status |

## How it works

1. **Ingest** (daily cron): RSS feeds and the YouTube Data API, de-duplicated; published transcripts only where the
   rights gate allows; daily YouTube view/like/comment snapshots; exact Spotify episode links.
2. **Understand** (Gemini Flash): guests, topics and sponsors extracted with evidence quotes that are verified against
   the episode text; entity resolution; embeddings and semantic clustering.
3. **Score**: age-matched engagement index, evidence confidence, versioned opportunity rubrics, and rule-based trend
   rubrics (`topic-trend-v1`, `spotify-trend-v1`, `discovery-trend-v1`). No trend label comes from an AI opinion.
4. **Deliver**: dashboard on Vercel; Monday brief via Resend (`30 1 * * 1` UTC = 07:00 IST).

## Stack

Next.js 16 (App Router, Cache Components) · TypeScript · Neon Postgres + pgvector · Drizzle ORM · Gemini Flash
(`gemini-3.5-flash`, `gemini-embedding-001`) · YouTube Data API · Spotify Web API · Tavily · Resend · Vitest · Vercel.

## Ground rules the code enforces

- Gemini Flash is the only AI. Tavily is used for raw search results only (its own AI answer is never requested).
- Spotify data is never sent to an AI model and Spotify observations older than 30 days are deleted (Spotify Developer Terms).
- Brand mentions are not called sponsors without evidence: disclosed / paid / affiliate / organic / unverified.
- Podcast text, transcripts, comments and web pages are treated as untrusted input (prompt-injection safe prompts).
- No contact details are invented, and no outreach is sent automatically. The only automatic email is the Monday brief.
- No audio transcription without recorded rights; no scraping against platform terms.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run db:migrate
npm run dev                  # http://localhost:3000
```

Environment variables (names only; see `.env.example`): `DATABASE_URL`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY`,
`RESEND_API_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `TAVILY_API_KEY`, and on Vercel `CRON_SECRET`
(Vercel Cron presents it to the `/api/cron/*` endpoints). The brief recipient is stored in the database
(`npx tsx scripts/set-recipient.ts you@example.com`).

## Checks

```bash
npm run typecheck && npx eslint src scripts && npm test   # 200 unit tests
npm run healthcheck          # APIs, data-safety rules, pages (needs the dev server)
npm run phase2-e2e && npm run phase3-e2e && npm run phase5-e2e && npm run research-e2e && npm run transcripts-e2e
npm run weekly-e2e           # sends 1-2 real emails to the configured recipient
```

## Known limits

- Vercel Hobby runs each cron once a day and up to ~59 minutes late.
- Resend is in test mode: it delivers only to the account owner's address.
- Spotify's API gives no plays, likes or followers for podcasts; likes and views shown come from YouTube.
- The app has no login by the founder's decision: every control on the live site is public.
