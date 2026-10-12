CREATE TABLE "opportunity_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entity_id" integer NOT NULL,
	"week_start" date NOT NULL,
	"score" numeric(5, 1) NOT NULL,
	"criteria" jsonb NOT NULL,
	"missing" jsonb NOT NULL,
	"confidence" jsonb NOT NULL,
	"rubric_version_id" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"weights" jsonb NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_rubric_version_id_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."rubric_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_scores_uq" ON "opportunity_scores" USING btree ("kind","entity_id","week_start");