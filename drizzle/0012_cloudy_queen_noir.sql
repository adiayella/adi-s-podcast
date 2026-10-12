ALTER TABLE "guests" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "photo_source" text;--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "photo_checked_at" timestamp with time zone;