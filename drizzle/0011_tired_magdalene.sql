CREATE TABLE "contact_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" integer NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"source_url" text,
	"verified" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edited" boolean DEFAULT false NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
