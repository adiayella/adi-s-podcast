import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

// ---------- enums ----------
export const sourceKind = pgEnum("source_kind", ["rss", "youtube"]);
export const evidenceSource = pgEnum("evidence_source", ["metadata", "transcript"]);
export const sponsorClass = pgEnum("sponsor_class", [
  "explicit_sponsor",
  "paid_promotion",
  "possible_affiliate",
  "organic_mention",
  "unknown",
]);
export const jobStage = pgEnum("job_stage", ["analyze", "resolve", "embed"]);
export const jobStatus = pgEnum("job_status", ["pending", "running", "done", "failed"]);
export const radarKind = pgEnum("radar_kind", ["guest", "topic", "sponsor"]);

// ---------- podcasts (configurable list) ----------
export const podcasts = pgTable("podcasts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rssUrl: text("rss_url").unique(),
  youtubeChannelId: text("youtube_channel_id"),
  enabled: boolean("enabled").notNull().default(true),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncStatus: text("last_sync_status"), // 'ok' | 'error' | null
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- episodes (one canonical row per real episode) ----------
export const episodes = pgTable(
  "episodes",
  {
    id: serial("id").primaryKey(),
    podcastId: integer("podcast_id").notNull().references(() => podcasts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    url: text("url"),
    // normalized title + podcast: used to merge the same episode seen via RSS and YouTube
    dedupeKey: text("dedupe_key").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("episodes_podcast_dedupe_uq").on(t.podcastId, t.dedupeKey),
    index("episodes_published_idx").on(t.publishedAt),
  ],
);

// one row per platform the episode was seen on
export const episodeSources = pgTable(
  "episode_sources",
  {
    id: serial("id").primaryKey(),
    episodeId: integer("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
    kind: sourceKind("kind").notNull(),
    externalId: text("external_id").notNull(), // RSS guid or YouTube video id
    url: text("url"),
    // YouTube enrichment (null for RSS rows)
    title: text("title"),
    description: text("description"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // The platform's paid-product-placement flag. It says an ad exists, never who the advertiser is.
    paidPromotion: boolean("paid_promotion").notNull().default(false),
  },
  (t) => [uniqueIndex("episode_sources_kind_ext_uq").on(t.kind, t.externalId)],
);

// ---------- guests ----------
export const guests = pgTable("guests", {
  id: serial("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  company: text("company"),
  role: text("role"),
  category: text("category"), // founder | executive | investor | creator | expert | journalist | other
  verified: boolean("verified").notNull().default(false),
  needsReview: boolean("needs_review").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const guestAliases = pgTable(
  "guest_aliases",
  {
    id: serial("id").primaryKey(),
    guestId: integer("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [uniqueIndex("guest_aliases_alias_uq").on(t.alias)],
);

export const guestAppearances = pgTable(
  "guest_appearances",
  {
    id: serial("id").primaryKey(),
    episodeId: integer("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
    guestId: integer("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
    confidence: real("confidence").notNull(),
    source: evidenceSource("source").notNull().default("metadata"),
    evidenceText: text("evidence_text"),
  },
  (t) => [
    uniqueIndex("guest_appearances_uq").on(t.episodeId, t.guestId),
    index("guest_appearances_guest_idx").on(t.guestId),
  ],
);

// ---------- topics ----------
export const topics = pgTable("topics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  parentTopicId: integer("parent_topic_id"),
  embedding: vector("embedding", { dimensions: 768 }),
});

export const episodeTopics = pgTable(
  "episode_topics",
  {
    id: serial("id").primaryKey(),
    episodeId: integer("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
    topicId: integer("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    confidence: real("confidence").notNull(),
    source: evidenceSource("source").notNull().default("metadata"),
  },
  (t) => [
    uniqueIndex("episode_topics_uq").on(t.episodeId, t.topicId),
    index("episode_topics_topic_idx").on(t.topicId),
  ],
);

// ---------- brands & sponsor evidence ----------
export const brands = pgTable("brands", {
  id: serial("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  category: text("category"),
  needsReview: boolean("needs_review").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brandAliases = pgTable(
  "brand_aliases",
  {
    id: serial("id").primaryKey(),
    brandId: integer("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
  },
  (t) => [uniqueIndex("brand_aliases_alias_uq").on(t.alias)],
);

export const sponsorEvidence = pgTable(
  "sponsor_evidence",
  {
    id: serial("id").primaryKey(),
    episodeId: integer("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
    brandId: integer("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    classification: sponsorClass("classification").notNull(),
    // required for anything above 'unknown'; enforced in the analyze stage
    evidenceQuote: text("evidence_quote"),
    confidence: real("confidence").notNull(),
    source: evidenceSource("source").notNull().default("metadata"),
    // The episode carried YouTube's paid-placement flag when this brand was found.
    platformPaidFlag: boolean("platform_paid_flag").notNull().default(false),
  },
  (t) => [
    uniqueIndex("sponsor_evidence_uq").on(t.episodeId, t.brandId),
    index("sponsor_evidence_brand_idx").on(t.brandId),
  ],
);

// ---------- NLP job queue ----------
export const analysisJobs = pgTable(
  "analysis_jobs",
  {
    id: serial("id").primaryKey(),
    episodeId: integer("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
    stage: jobStage("stage").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    // bump when the prompt changes so episodes can be re-analyzed deliberately
    promptVersion: text("prompt_version").notNull().default("v1"),
    rawOutput: jsonb("raw_output"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("analysis_jobs_uq").on(t.episodeId, t.stage, t.promptVersion),
    index("analysis_jobs_status_idx").on(t.status),
  ],
);

// ---------- scores, reports, scheduling ----------
export const scoreSnapshots = pgTable(
  "score_snapshots",
  {
    id: serial("id").primaryKey(),
    kind: radarKind("kind").notNull(),
    entityId: integer("entity_id").notNull(),
    weekStart: date("week_start").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    rawCounts: jsonb("raw_counts").notNull(), // the real numbers behind the score
    components: jsonb("components").notNull(), // normalized sub-scores and weights used
  },
  (t) => [uniqueIndex("score_snapshots_uq").on(t.kind, t.entityId, t.weekStart)],
);

export const weeklyReports = pgTable("weekly_reports", {
  id: serial("id").primaryKey(),
  weekStart: date("week_start").notNull().unique(),
  statsJson: jsonb("stats_json").notNull(), // SQL-computed facts
  briefMarkdown: text("brief_markdown").notNull(), // Gemini-written narrative
  emailStatus: text("email_status").notNull().default("pending"), // pending | sent | failed
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobRuns = pgTable("job_runs", {
  id: serial("id").primaryKey(),
  job: text("job").notNull(), // 'daily' | 'weekly' ...
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  detail: jsonb("detail"),
});

// key/value config: score weights, brief send time, recipient
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const enablePgvector = sql`CREATE EXTENSION IF NOT EXISTS vector`;

// =====================================================================================
// Research Control Center
// Monitored universe = podcasts/episodes above. Discovery universe = the tables below.
// They never share rows, so cross-show counts and rankings cannot mix the two.
// =====================================================================================

// Founder's research preferences, one row per saved version. The active version is the highest number.
export const researchSettingsVersions = pgTable("research_settings_versions", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull().unique(),
  config: jsonb("config").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const discoveryCandidates = pgTable(
  "discovery_candidates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(), // normalised name: the same show found twice is one row
    publisher: text("publisher"),
    source: text("source").notNull(), // 'apple' | 'youtube'
    appleId: text("apple_id").unique(),
    rssUrl: text("rss_url").unique(),
    youtubeChannelId: text("youtube_channel_id").unique(),
    language: text("language"),
    country: text("country"),
    genre: text("genre"),
    // 'new' | 'saved' | 'approved' | 'dismissed' | 'excluded'. Only the founder can move a candidate to 'approved'.
    status: text("status").notNull().default("new"),
    foundVia: text("found_via"),
    metrics: jsonb("metrics"), // publishing activity computed from the real feed
    engagement: jsonb("engagement"), // YouTube views/likes/comments where a channel is known
    relevance: real("relevance"),
    relevanceDetail: jsonb("relevance_detail"),
    trendLabel: text("trend_label"), // 'trending' | 'emerging' | 'active' | 'inactive'
    trendEvidence: jsonb("trend_evidence"),
    reason: text("reason"),
    evidenceEpisodes: jsonb("evidence_episodes"),
    promotedPodcastId: integer("promoted_podcast_id").references(() => podcasts.id, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("discovery_candidates_name_key_uq").on(t.nameKey), index("discovery_candidates_status_idx").on(t.status)],
);

// One row per evaluation, so growth can be judged over time and not from a single look.
export const discoveryCandidateSnapshots = pgTable(
  "discovery_candidate_snapshots",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull().references(() => discoveryCandidates.id, { onDelete: "cascade" }),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    metrics: jsonb("metrics").notNull(),
  },
  (t) => [index("discovery_snapshots_candidate_idx").on(t.candidateId, t.takenAt)],
);

export const discoveryEpisodes = pgTable(
  "discovery_episodes",
  {
    id: serial("id").primaryKey(),
    candidateId: integer("candidate_id").notNull().references(() => discoveryCandidates.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    url: text("url"),
    dedupeKey: text("dedupe_key").notNull(),
    views: integer("views"),
    likes: integer("likes"),
    comments: integer("comments"),
  },
  (t) => [uniqueIndex("discovery_episodes_uq").on(t.candidateId, t.dedupeKey), index("discovery_episodes_published_idx").on(t.publishedAt)],
);

// Gemini extraction for discovery episodes, stored apart from analysis_jobs (which belongs to monitored episodes).
export const discoveryAnalyses = pgTable(
  "discovery_analyses",
  {
    id: serial("id").primaryKey(),
    discoveryEpisodeId: integer("discovery_episode_id").notNull().references(() => discoveryEpisodes.id, { onDelete: "cascade" }),
    promptVersion: text("prompt_version").notNull(),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("discovery_analyses_uq").on(t.discoveryEpisodeId, t.promptVersion)],
);

// Cache for external search/lookup responses, so repeated runs do not spend quota on the same question.
export const apiCache = pgTable("api_cache", {
  key: text("key").primaryKey(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Daily quota accounting per provider (YouTube Data API units).
export const apiUsage = pgTable(
  "api_usage",
  {
    id: serial("id").primaryKey(),
    day: date("day").notNull(),
    provider: text("provider").notNull(),
    units: integer("units").notNull().default(0),
  },
  (t) => [uniqueIndex("api_usage_day_provider_uq").on(t.day, t.provider)],
);
