CREATE TABLE "episode_transcripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"format" text,
	"language" text,
	"rights_basis" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"plain_text" text,
	"segments" jsonb,
	"word_count" integer,
	"content_hash" text,
	"error" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "episode_sources" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "coverage" text DEFAULT 'metadata' NOT NULL;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "transcript_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_appearances" ADD COLUMN "evidence_seconds" integer;--> statement-breakpoint
ALTER TABLE "podcasts" ADD COLUMN "allow_public_transcripts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "podcasts" ADD COLUMN "audio_transcription_rights" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "sponsor_evidence" ADD COLUMN "evidence_seconds" integer;--> statement-breakpoint
ALTER TABLE "episode_transcripts" ADD CONSTRAINT "episode_transcripts_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_transcripts_uq" ON "episode_transcripts" USING btree ("episode_id","source");--> statement-breakpoint
CREATE INDEX "episode_transcripts_status_idx" ON "episode_transcripts" USING btree ("status");