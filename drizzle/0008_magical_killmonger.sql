CREATE TABLE "episode_metric_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_source_id" integer NOT NULL,
	"captured_on" date NOT NULL,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episode_metric_snapshots" ADD CONSTRAINT "episode_metric_snapshots_episode_source_id_episode_sources_id_fk" FOREIGN KEY ("episode_source_id") REFERENCES "public"."episode_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "episode_metric_snapshots_uq" ON "episode_metric_snapshots" USING btree ("episode_source_id","captured_on");