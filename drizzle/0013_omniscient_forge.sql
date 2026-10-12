CREATE TABLE "spotify_sector_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"sector" text NOT NULL,
	"observed_on" date NOT NULL,
	"rank" integer NOT NULL,
	"spotify_show_id" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"spotify_url" text NOT NULL,
	"total_episodes" integer NOT NULL,
	"languages" jsonb NOT NULL,
	"score" real NOT NULL,
	"label" text NOT NULL,
	"components" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"sample_episodes" jsonb NOT NULL,
	"rubric_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "spotify_obs_uq" ON "spotify_sector_observations" USING btree ("sector","spotify_show_id","observed_on");--> statement-breakpoint
CREATE INDEX "spotify_obs_day_idx" ON "spotify_sector_observations" USING btree ("observed_on");