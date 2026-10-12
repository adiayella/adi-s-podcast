ALTER TABLE "weekly_reports" ADD COLUMN "generation_status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "generation_error" text;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "send_status" text DEFAULT 'not_sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "send_error" text;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "send_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "recipient" text;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "provider_email_id" text;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "delivery_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "delivery_event" text;--> statement-breakpoint
ALTER TABLE "weekly_reports" ADD COLUMN "delivery_checked_at" timestamp with time zone;--> statement-breakpoint
UPDATE "weekly_reports" SET "generated_at" = "created_at", "send_status" = CASE "email_status" WHEN 'sent' THEN 'accepted' WHEN 'failed' THEN 'failed' ELSE 'not_sent' END, "provider_email_id" = "stats_json"->'meta'->>'emailId', "send_attempts" = CASE WHEN "email_status" = 'pending' THEN 0 ELSE 1 END;
