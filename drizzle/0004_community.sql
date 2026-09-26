CREATE TYPE "public"."community_subscriber_status" AS ENUM('pending', 'confirmed', 'unsubscribed');--> statement-breakpoint
CREATE TYPE "public"."community_application_status" AS ENUM('pending', 'reviewing', 'accepted', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."community_action_token_purpose" AS ENUM('subscription_confirmation', 'unsubscribe', 'application_receipt');--> statement-breakpoint
CREATE TABLE "community_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"status" "community_subscriber_status" DEFAULT 'pending' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"introduction" text NOT NULL,
	"status" "community_application_status" DEFAULT 'pending' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" "community_action_token_purpose" NOT NULL,
	"subscriber_id" uuid,
	"application_id" uuid,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_action_tokens_target_check" CHECK (("subscriber_id" IS NOT NULL AND "application_id" IS NULL) OR ("subscriber_id" IS NULL AND "application_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "community_rate_limits" (
	"scope" text NOT NULL,
	"bucket" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_rate_limits_scope_bucket_window_started_at_pk" PRIMARY KEY("scope","bucket","window_started_at")
);
--> statement-breakpoint
CREATE TABLE "community_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"initial_published_at" timestamp with time zone NOT NULL,
	"automatic_notice_queued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_action_tokens" ADD CONSTRAINT "community_action_tokens_subscriber_id_community_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."community_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_action_tokens" ADD CONSTRAINT "community_action_tokens_application_id_community_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."community_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_publications" ADD CONSTRAINT "community_publications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_subscribers_email_unique" ON "community_subscribers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "community_subscribers_status_index" ON "community_subscribers" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "community_applications_status_created_index" ON "community_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "community_applications_email_index" ON "community_applications" USING btree ("email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_action_tokens_hash_unique" ON "community_action_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "community_action_tokens_subscriber_index" ON "community_action_tokens" USING btree ("subscriber_id","purpose");--> statement-breakpoint
CREATE INDEX "community_action_tokens_application_index" ON "community_action_tokens" USING btree ("application_id","purpose");--> statement-breakpoint
CREATE INDEX "community_action_tokens_expiry_index" ON "community_action_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "community_rate_limits_window_index" ON "community_rate_limits" USING btree ("window_started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_publications_document_unique" ON "community_publications" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "community_publications_initial_published_index" ON "community_publications" USING btree ("initial_published_at");--> statement-breakpoint
-- Existing public or formerly published posts receive a marker without creating a mail job.
-- The audit-log fallback covers records whose old public snapshot was cleared by unpublish.
INSERT INTO "community_publications" ("document_id", "snapshot", "snapshot_hash", "initial_published_at", "created_at")
SELECT
	"documents"."id",
	COALESCE("documents"."published", "documents"."draft"),
	md5(COALESCE("documents"."published", "documents"."draft")::text),
	COALESCE(
		"documents"."published_at",
		(SELECT min("audit_log"."created_at") FROM "audit_log" WHERE "audit_log"."action" = 'document.publish' AND "audit_log"."resource_id" = "documents"."id"::text),
		"documents"."created_at"
	),
	now()
FROM "documents"
WHERE "documents"."kind" = 'post'
	AND (
		"documents"."published" IS NOT NULL
		OR EXISTS (SELECT 1 FROM "audit_log" WHERE "audit_log"."action" = 'document.publish' AND "audit_log"."resource_id" = "documents"."id"::text)
	)
ON CONFLICT ("document_id") DO NOTHING;
