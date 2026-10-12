CREATE TABLE "audience_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_source_id" integer NOT NULL,
	"sample_size" integer NOT NULL,
	"total_comments" integer,
	"items" jsonb NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"analysed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_themes" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"support" integer NOT NULL,
	"videos" integer NOT NULL,
	"podcasts" jsonb NOT NULL,
	"quotes" jsonb NOT NULL,
	"interview_questions" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"episode_ids" jsonb NOT NULL,
	"podcast_count" integer NOT NULL,
	"episode_count" integer NOT NULL,
	"recent_count" integer NOT NULL,
	"prior_count" integer NOT NULL,
	"cohesion" numeric(4, 3) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audience_findings" ADD CONSTRAINT "audience_findings_episode_source_id_episode_sources_id_fk" FOREIGN KEY ("episode_source_id") REFERENCES "public"."episode_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audience_findings_source_uq" ON "audience_findings" USING btree ("episode_source_id");