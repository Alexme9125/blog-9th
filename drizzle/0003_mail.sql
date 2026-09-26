CREATE TYPE "public"."mail_security" AS ENUM('tls', 'starttls');--> statement-breakpoint
CREATE TYPE "public"."mail_job_kind" AS ENUM('subscription-confirm', 'post', 'application-copy', 'application-notification', 'test');--> statement-breakpoint
CREATE TYPE "public"."mail_job_status" AS ENUM('queued', 'processing', 'sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TABLE "mail_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"security" "mail_security" DEFAULT 'starttls' NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"password_encrypted" text,
	"from_name" text DEFAULT '' NOT NULL,
	"from_email" text DEFAULT '' NOT NULL,
	"reply_to" text DEFAULT '' NOT NULL,
	"application_recipient" text DEFAULT '' NOT NULL,
	"notify_on_publish" boolean DEFAULT false NOT NULL,
	"allow_manual_push" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_settings_singleton_check" CHECK ("id" = 'default')
);
--> statement-breakpoint
CREATE TABLE "mail_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" "mail_job_kind" NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "mail_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_jobs_attempts_nonnegative_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_jobs_dedupe_key_unique" ON "mail_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "mail_jobs_pending_index" ON "mail_jobs" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "mail_jobs_lock_index" ON "mail_jobs" USING btree ("status","locked_at");
