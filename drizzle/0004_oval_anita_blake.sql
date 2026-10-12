CREATE TABLE "api_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"discovery_episode_id" integer NOT NULL,
	"prompt_version" text NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_candidate_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"publisher" text,
	"source" text NOT NULL,
	"apple_id" text,
	"rss_url" text,
	"youtube_channel_id" text,
	"language" text,
	"country" text,
	"genre" text,
	"status" text DEFAULT 'new' NOT NULL,
	"found_via" text,
	"metrics" jsonb,
	"engagement" jsonb,
	"relevance" real,
	"relevance_detail" jsonb,
	"trend_label" text,
	"trend_evidence" jsonb,
	"reason" text,
	"evidence_episodes" jsonb,
	"promoted_podcast_id" integer,
	"decision_note" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_evaluated_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	CONSTRAINT "discovery_candidates_apple_id_unique" UNIQUE("apple_id"),
	CONSTRAINT "discovery_candidates_rss_url_unique" UNIQUE("rss_url"),
	CONSTRAINT "discovery_candidates_youtube_channel_id_unique" UNIQUE("youtube_channel_id")
);
--> statement-breakpoint
CREATE TABLE "discovery_episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"published_at" timestamp with time zone NOT NULL,
	"url" text,
	"dedupe_key" text NOT NULL,
	"views" integer,
	"likes" integer,
	"comments" integer
);
--> statement-breakpoint
CREATE TABLE "research_settings_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_settings_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
ALTER TABLE "discovery_analyses" ADD CONSTRAINT "discovery_analyses_discovery_episode_id_discovery_episodes_id_fk" FOREIGN KEY ("discovery_episode_id") REFERENCES "public"."discovery_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidate_snapshots" ADD CONSTRAINT "discovery_candidate_snapshots_candidate_id_discovery_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."discovery_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_promoted_podcast_id_podcasts_id_fk" FOREIGN KEY ("promoted_podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_episodes" ADD CONSTRAINT "discovery_episodes_candidate_id_discovery_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."discovery_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_usage_day_provider_uq" ON "api_usage" USING btree ("day","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_analyses_uq" ON "discovery_analyses" USING btree ("discovery_episode_id","prompt_version");--> statement-breakpoint
CREATE INDEX "discovery_snapshots_candidate_idx" ON "discovery_candidate_snapshots" USING btree ("candidate_id","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_candidates_name_key_uq" ON "discovery_candidates" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "discovery_candidates_status_idx" ON "discovery_candidates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_episodes_uq" ON "discovery_episodes" USING btree ("candidate_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "discovery_episodes_published_idx" ON "discovery_episodes" USING btree ("published_at");