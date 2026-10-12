CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."evidence_source" AS ENUM('metadata', 'transcript');--> statement-breakpoint
CREATE TYPE "public"."job_stage" AS ENUM('analyze', 'resolve', 'embed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."radar_kind" AS ENUM('guest', 'topic', 'sponsor');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('rss', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."sponsor_class" AS ENUM('explicit_sponsor', 'paid_promotion', 'possible_affiliate', 'organic_mention', 'unknown');--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"stage" "job_stage" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"prompt_version" text DEFAULT 'v1' NOT NULL,
	"raw_output" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"category" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"kind" "source_kind" NOT NULL,
	"external_id" text NOT NULL,
	"url" text
);
--> statement-breakpoint
CREATE TABLE "episode_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"topic_id" integer NOT NULL,
	"confidence" real NOT NULL,
	"source" "evidence_source" DEFAULT 'metadata' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"podcast_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"published_at" timestamp with time zone NOT NULL,
	"url" text,
	"dedupe_key" text NOT NULL,
	"embedding" vector(768),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"guest_id" integer NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_appearances" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"guest_id" integer NOT NULL,
	"confidence" real NOT NULL,
	"source" "evidence_source" DEFAULT 'metadata' NOT NULL,
	"evidence_text" text
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" serial PRIMARY KEY NOT NULL,
	"canonical_name" text NOT NULL,
	"company" text,
	"role" text,
	"verified" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "podcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rss_url" text,
	"youtube_channel_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "radar_kind" NOT NULL,
	"entity_id" integer NOT NULL,
	"week_start" date NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"raw_counts" jsonb NOT NULL,
	"components" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsor_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"classification" "sponsor_class" NOT NULL,
	"evidence_quote" text,
	"confidence" real NOT NULL,
	"source" "evidence_source" DEFAULT 'metadata' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_topic_id" integer,
	"embedding" vector(768),
	CONSTRAINT "topics_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "weekly_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"stats_json" jsonb NOT NULL,
	"brief_markdown" text NOT NULL,
	"email_status" text DEFAULT 'pending' NOT NULL,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reports_week_start_unique" UNIQUE("week_start")
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_aliases" ADD CONSTRAINT "brand_aliases_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_sources" ADD CONSTRAINT "episode_sources_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_topics" ADD CONSTRAINT "episode_topics_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_topics" ADD CONSTRAINT "episode_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_podcast_id_podcasts_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_aliases" ADD CONSTRAINT "guest_aliases_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_appearances" ADD CONSTRAINT "guest_appearances_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_appearances" ADD CONSTRAINT "guest_appearances_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_evidence" ADD CONSTRAINT "sponsor_evidence_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_evidence" ADD CONSTRAINT "sponsor_evidence_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_jobs_uq" ON "analysis_jobs" USING btree ("episode_id","stage","prompt_version");--> statement-breakpoint
CREATE INDEX "analysis_jobs_status_idx" ON "analysis_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_aliases_alias_uq" ON "brand_aliases" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_sources_kind_ext_uq" ON "episode_sources" USING btree ("kind","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episode_topics_uq" ON "episode_topics" USING btree ("episode_id","topic_id");--> statement-breakpoint
CREATE INDEX "episode_topics_topic_idx" ON "episode_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_podcast_dedupe_uq" ON "episodes" USING btree ("podcast_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "episodes_published_idx" ON "episodes" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_aliases_alias_uq" ON "guest_aliases" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_appearances_uq" ON "guest_appearances" USING btree ("episode_id","guest_id");--> statement-breakpoint
CREATE INDEX "guest_appearances_guest_idx" ON "guest_appearances" USING btree ("guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_snapshots_uq" ON "score_snapshots" USING btree ("kind","entity_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_evidence_uq" ON "sponsor_evidence" USING btree ("episode_id","brand_id");--> statement-breakpoint
CREATE INDEX "sponsor_evidence_brand_idx" ON "sponsor_evidence" USING btree ("brand_id");