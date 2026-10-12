import { desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { cacheHas, cached, withYoutubeBudget } from "@/lib/api-budget";
import { engagementOf, evaluateTrend, explain, publishingMetrics, relevanceOf, type CandidateEpisode } from "@/discovery/evaluate";
import { appleSearch, fetchFeed, findFeedByName, languageAllowed, mapToChannel, youtubeChannelSearch, youtubeEpisodes, type AppleHit } from "@/discovery/sources";
import { effortBudget, isDue, type ResearchConfig } from "@/research/config";
import { extractEpisode } from "@/nlp/extract";
import { normalize } from "@/nlp/verify";
import { PROMPT_VERSION } from "@/nlp/taxonomy";
import { dedupeKey } from "@/services/ingest";
import { lastRealRun } from "@/services/job-log";
import { getActiveConfig } from "@/services/research-settings";
import { titleSimilarity } from "@/services/youtube";

const { discoveryCandidates: cand, discoveryEpisodes: dep, discoveryAnalyses: dan, discoveryCandidateSnapshots: snaps, podcasts } = schema;

type Detail = Record<string, unknown>;
const DAY = 86_400_000;
const bump = (d: Detail, k: string, n = 1) => (d[k] = ((d[k] as number) ?? 0) + n);
const note = (d: Detail, k: string, msg: string) => ((d[k] as string[]) ??= []).length < 8 && (d[k] as string[]).push(msg);

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

/** Search phrases: the founder's own interests first, then the broad categories. */
export function searchTerms(c: ResearchConfig): string[] {
  const own = [...c.keywords, ...c.founders, ...c.companies, ...c.products];
  const all = [...own, ...c.categories];
  const seen = new Set<string>();
  return all.filter((t) => {
    const k = normalize(t);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The discovery job body. Reads the founder's settings at run time, so edits apply to the next run. */
export async function discoverCore(d: Detail, opts: { force?: boolean } = {}): Promise<void> {
  const { version, config } = await getActiveConfig();
  d.settingsVersion = version;
  d.effort = config.effort;
  if (!config.modes.discovery.enabled) {
    d.skipped = "Discovery mode is switched off";
    return;
  }
  if (!opts.force && !isDue(config.frequency.discovery, await lastRealRun("discovery"))) {
    d.skipped = `Not due yet (runs ${config.frequency.discovery})`;
    return;
  }
  const budget = effortBudget(config);
  d.budget = budget;

  // ---- what is already known: never suggest a monitored, dismissed, excluded or approved show again
  const monitored = await db.select({ name: podcasts.name, rssUrl: podcasts.rssUrl }).from(podcasts);
  const monitoredKeys = new Set(monitored.map((p) => normalize(p.name)));
  const monitoredFeeds = new Set(monitored.map((p) => p.rssUrl).filter(Boolean) as string[]);
  const blocked = await db.select({ key: cand.nameKey }).from(cand).where(inArray(cand.status, ["dismissed", "excluded", "approved"]));
  const blockedKeys = new Set(blocked.map((b) => b.key));

  // ---- 1. search the free Apple directory with the founder's terms; new lookups are capped by the effort setting
  const terms = searchTerms(config);
  const markets = config.markets.length ? config.markets : ["IN"];
  d.terms = terms.slice(0, 12);
  const pool = new Map<string, { hit: AppleHit; term: string; seen: number }>();
  let newLookups = 0;
  for (const term of terms) {
    for (const market of markets) {
      const isCached = await cacheHas(`apple:${market}:${normalize(term)}`);
      if (!isCached && newLookups >= budget.maxSearchTerms) continue;
      try {
        const { hits, cacheHit } = await appleSearch(term, market);
        if (cacheHit) bump(d, "cacheHits");
        else {
          newLookups++;
          bump(d, "appleSearches");
        }
        for (const h of hits) {
          if (!h.feedUrl) continue;
          const key = normalize(h.name);
          const prev = pool.get(key);
          pool.set(key, { hit: prev?.hit ?? h, term: prev?.term ?? term, seen: (prev?.seen ?? 0) + 1 });
        }
      } catch (e) {
        note(d, "errors", `search "${term}": ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  d.poolSize = pool.size;

  // ---- 2. cheap filters before spending any time on feeds
  const fresh = [...pool.entries()].filter(([key, v]) => {
    if (monitoredKeys.has(key) || blockedKeys.has(key) || monitoredFeeds.has(v.hit.feedUrl!)) return false;
    const latest = v.hit.latestAt ? Date.now() - new Date(v.hit.latestAt).getTime() : Infinity;
    return latest < 60 * DAY && v.hit.trackCount >= 6;
  });
  const checked = await Promise.all(fresh.map(async ([key, v]) => ({ key, v, rejected: await cacheHas(`rejected:${key}`) })));
  const queue = checked
    .filter((x) => !x.rejected)
    .sort((a, b) => b.v.seen - a.v.seen || new Date(b.v.hit.latestAt ?? 0).getTime() - new Date(a.v.hit.latestAt ?? 0).getTime())
    .slice(0, budget.maxFeedsToFetch);
  d.feedsToCheck = queue.length;

  // ---- 3. read each real feed, measure publishing activity and relevance, keep the ones that qualify
  const touched = new Set<number>();
  for (const { key, v } of queue) {
    try {
      const feed = await fetchFeed(v.hit.feedUrl!, 90);
      bump(d, "feedsFetched");
      if (!languageAllowed(feed.language, config.languages)) {
        await cached(`rejected:${key}`, 24 * 30, async () => true);
        bump(d, "wrongLanguage");
        continue;
      }
      const metrics = publishingMetrics(feed.episodes);
      const relevance = relevanceOf(feed.episodes, config, metrics);
      const trend = evaluateTrend({ metrics, relevance, engagement: null, priorSnapshots: [] });
      // keep only shows that really cover the founder's interests: a couple of passing mentions is not enough
      if (relevance.score < 25 || relevance.relevantEpisodes90d < 3 || trend.label === "inactive") {
        await cached(`rejected:${key}`, 24 * 30, async () => true); // do not re-fetch this feed for a month
        bump(d, "notRelevant");
        continue;
      }
      const [row] = await db
        .insert(cand)
        .values({ name: v.hit.name, nameKey: key, publisher: v.hit.publisher, source: "apple", appleId: v.hit.appleId, rssUrl: v.hit.feedUrl, language: feed.language, country: v.hit.country, genre: v.hit.genre, foundVia: v.term })
        .onConflictDoUpdate({ target: cand.nameKey, set: { rssUrl: v.hit.feedUrl, language: feed.language } })
        .returning({ id: cand.id, firstSeenAt: cand.firstSeenAt });
      touched.add(row.id);
      for (let i = 0; i < feed.episodes.length; i += 50) {
        await db
          .insert(dep)
          .values(feed.episodes.slice(i, i + 50).map((e) => ({ candidateId: row.id, title: e.title, description: e.description ?? null, publishedAt: e.publishedAt, url: e.url ?? null, dedupeKey: e.dedupeKey })))
          .onConflictDoNothing();
      }
      bump(d, "candidatesKept");
    } catch (e) {
      note(d, "errors", `feed ${v.hit.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ---- 4. YouTube: map top candidates to channels, read real view counts, optionally search channels directly
  if (budget.discoveryYoutubeUnits > 0 && process.env.YOUTUBE_API_KEY) {
    const yt = await withYoutubeBudget(budget.discoveryYoutubeUnits, async (b) => {
      const top = await rows<{ id: number; name: string; youtubeChannelId: string | null }>(sql`
        select id, name, youtube_channel_id as "youtubeChannelId" from discovery_candidates
        where status in ('new', 'saved') order by coalesce(relevance, 0) desc, id limit 12`);
      let mappings = 0;
      for (const c of top) {
        if (c.youtubeChannelId || mappings >= 3 || b.remaining() < 150) continue;
        mappings++;
        const ch = await mapToChannel(c.name);
        if (ch) {
          await db.update(cand).set({ youtubeChannelId: ch.channelId }).where(eq(cand.id, c.id)).catch(() => undefined);
          c.youtubeChannelId = ch.channelId;
          bump(d, "channelsMapped");
        }
      }
      for (const c of top.filter((x) => x.youtubeChannelId).slice(0, 6)) {
        if (b.remaining() < 5) break;
        const vids = await youtubeEpisodes(c.youtubeChannelId!, 90);
        const mine = await db.select().from(dep).where(eq(dep.candidateId, c.id));
        for (const e of mine) {
          const match = vids
            .map((v) => ({ v, s: titleSimilarity(v.title, e.title), gap: Math.abs(v.publishedAt.getTime() - e.publishedAt.getTime()) / DAY }))
            .filter((m) => m.s >= 0.5 && m.gap <= 14)
            .sort((a, z) => z.s - a.s)[0];
          if (match) await db.update(dep).set({ views: match.v.views ?? null }).where(eq(dep.id, e.id));
        }
        touched.add(c.id);
        bump(d, "engagementChecked");
      }
      // direct channel search with the founder's first interest term, only if plenty of budget remains
      const term = terms[0];
      if (term && b.remaining() >= 300) {
        const { hits, cacheHit } = await youtubeChannelSearch(term, markets[0]);
        if (cacheHit) bump(d, "cacheHits");
        for (const h of hits.filter((x) => (x.videoCount ?? 0) >= 50).slice(0, 3)) {
          const key = normalize(h.title);
          if (monitoredKeys.has(key) || blockedKeys.has(key) || (await cacheHas(`rejected:${key}`))) continue;
          const eps = await youtubeEpisodes(h.channelId, 90);
          const m = publishingMetrics(eps);
          const r = relevanceOf(eps, config, m);
          if (r.score < 25 || r.relevantEpisodes90d < 3 || evaluateTrend({ metrics: m, relevance: r, engagement: null, priorSnapshots: [] }).label === "inactive") {
            await cached(`rejected:${key}`, 24 * 30, async () => true);
            continue;
          }
          const feedUrl = await findFeedByName(h.title, markets[0]).catch(() => null);
          const [row] = await db
            .insert(cand)
            .values({ name: h.title, nameKey: key, source: "youtube", youtubeChannelId: h.channelId, rssUrl: feedUrl, foundVia: term })
            .onConflictDoUpdate({ target: cand.nameKey, set: { youtubeChannelId: h.channelId } })
            .returning({ id: cand.id });
          await db.insert(dep).values(eps.map((e) => ({ candidateId: row.id, title: e.title, description: e.description ?? null, publishedAt: e.publishedAt, url: e.url ?? null, dedupeKey: dedupeKey(e.title), views: e.views ?? null }))).onConflictDoNothing();
          touched.add(row.id);
          bump(d, "youtubeNativeCandidates");
        }
      }
    });
    d.youtubeUnitsSpent = yt.spent;
    if (yt.stoppedByQuota) d.stoppedByQuota = true;
  }

  // ---- 5. Gemini reads the newest episodes of the most relevant candidates (bounded by the effort setting)
  if (budget.maxEpisodesToAnalyze > 0) {
    const todo = await rows<{ id: number; title: string; description: string | null; publishedAt: string; name: string }>(sql`
      select e.id, e.title, e.description, e.published_at as "publishedAt", c.name
      from discovery_episodes e join discovery_candidates c on c.id = e.candidate_id
      where c.status in ('new', 'saved') and coalesce(c.relevance, 100) >= 25 and e.published_at > now() - interval '45 days'
        and not exists (select 1 from discovery_analyses a where a.discovery_episode_id = e.id and a.prompt_version = ${PROMPT_VERSION})
      order by coalesce(c.relevance, 0) desc, e.published_at desc limit ${budget.maxEpisodesToAnalyze}`);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, todo.length) }, async () => {
        while (next < todo.length) {
          const e = todo[next++];
          try {
            const r = await extractEpisode({ podcast: e.name, title: e.title, description: e.description ?? "", publishedAt: new Date(e.publishedAt).toISOString().slice(0, 10) });
            await db.insert(dan).values({ discoveryEpisodeId: e.id, promptVersion: PROMPT_VERSION, raw: { extraction: r.extraction, rejected: r.rejected } }).onConflictDoNothing();
            bump(d, "episodesAnalysed");
          } catch (err) {
            note(d, "errors", `analysis: ${err instanceof Error ? err.message : err}`);
          }
        }
      }),
    );
  }

  // ---- 6. final evaluation with everything known: engagement, topics from analysis, and history
  const all = await db.select({ id: cand.id }).from(cand).where(inArray(cand.status, ["new", "saved"]));
  for (const { id } of all) await reevaluateCandidate(id, config);
  d.candidatesEvaluated = all.length;
  d.trending = (await rows<{ n: number }>(sql`select count(*)::int n from discovery_candidates where status in ('new','saved') and trend_label = 'trending'`))[0]?.n ?? 0;
}

/** Recompute one candidate's metrics, relevance, trend label and explanation from its stored real episodes. */
export async function reevaluateCandidate(id: number, config: ResearchConfig): Promise<void> {
  const now = new Date();
  const eps = await rows<{ id: number; title: string; description: string | null; publishedAt: string; url: string | null; views: number | null; topics: string[] | null }>(sql`
    select e.id, e.title, e.description, e.published_at as "publishedAt", e.url, e.views,
      (select array_agg(t) from (select distinct jsonb_array_elements(a.raw->'extraction'->'topics')->>'topic' as t from discovery_analyses a where a.discovery_episode_id = e.id) x) as topics
    from discovery_episodes e where e.candidate_id = ${id} and e.published_at > now() - interval '90 days' order by e.published_at desc`);
  const episodes: (CandidateEpisode & { id: number })[] = eps.map((e) => ({ id: e.id, title: e.title, description: e.description, publishedAt: new Date(e.publishedAt), url: e.url, views: e.views, topics: e.topics ?? [] }));
  const metrics = publishingMetrics(episodes, now);
  const relevance = relevanceOf(episodes, config, metrics, now);
  const engagement = engagementOf(episodes);
  const prior = await db.select().from(snaps).where(eq(snaps.candidateId, id)).orderBy(desc(snaps.takenAt)).limit(3);
  const priorSnapshots = prior.map((p) => ({ relevantEpisodes30d: Number((p.metrics as { relevantEpisodes30d?: number }).relevantEpisodes30d ?? 0) }));
  const trend = evaluateTrend({ metrics, relevance, engagement, priorSnapshots });
  const relevantEps = episodes.filter((e) => relevanceOf([e], config, metrics, now).relevantEpisodes90d > 0).slice(0, 4);
  const evidence = (relevantEps.length ? relevantEps : episodes.slice(0, 3)).map((e) => ({ title: e.title, url: e.url ?? null, at: e.publishedAt.toISOString() }));
  const [c] = await db.select({ name: cand.name }).from(cand).where(eq(cand.id, id));
  await db
    .update(cand)
    .set({
      metrics: { ...metrics, relevantEpisodes90d: relevance.relevantEpisodes90d, relevantEpisodes30d: relevance.relevantEpisodes30d, relevantEpisodesPrev30d: relevance.relevantEpisodesPrev30d },
      engagement,
      relevance: relevance.score,
      relevanceDetail: { components: relevance.components, matchedInterests: relevance.matchedInterests, excludedShare: relevance.excludedShare },
      trendLabel: trend.label,
      trendEvidence: { signals: trend.signals, signalsMet: trend.signalsMet },
      reason: explain({ name: c?.name ?? "", relevance, metrics, trend, sampleTitles: evidence.map((x) => x.title) }),
      evidenceEpisodes: evidence,
      lastEvaluatedAt: now,
    })
    .where(eq(cand.id, id));
  const last = prior[0];
  if (!last || now.getTime() - new Date(last.takenAt).getTime() > 12 * 3_600_000)
    await db.insert(snaps).values({ candidateId: id, metrics: { ...metrics, relevantEpisodes30d: relevance.relevantEpisodes30d, relevance: relevance.score } });
}

/** Re-score every open candidate from stored data (no network), and drop un-reviewed ones that no longer qualify. */
export async function reevaluateAll(): Promise<{ evaluated: number; pruned: number }> {
  const { config } = await getActiveConfig();
  const open = await db.select({ id: cand.id }).from(cand).where(inArray(cand.status, ["new", "saved"]));
  for (const { id } of open) await reevaluateCandidate(id, config);
  const pruned = await rows<{ id: number }>(sql`
    delete from discovery_candidates
    where status = 'new' and (coalesce((metrics->>'relevantEpisodes90d')::int, 0) < 3 or trend_label = 'inactive') returning id`);
  return { evaluated: open.length, pruned: pruned.length };
}
