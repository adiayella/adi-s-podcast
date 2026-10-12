ALTER TABLE "episode_sources" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "episode_sources" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "episode_sources" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episode_sources" ADD COLUMN "paid_promotion" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sponsor_evidence" ADD COLUMN "platform_paid_flag" boolean DEFAULT false NOT NULL;