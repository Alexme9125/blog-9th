import type {
  MailKind,
  MailMetadata,
  MailSecurity,
  MailJobStatus,
} from "@/lib/mail/types";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const mailSecurityEnum = pgEnum("mail_security", ["tls", "starttls"]);
export const mailJobKindEnum = pgEnum("mail_job_kind", [
  "subscription-confirm",
  "post",
  "application-copy",
  "application-notification",
  "test",
]);
export const mailJobStatusEnum = pgEnum("mail_job_status", [
  "queued",
  "processing",
  "sent",
  "failed",
  "suppressed",
]);

/** A singleton row (`id = 'default'`) keeps SMTP credentials separate from general site settings. */
export const mailSettings = pgTable(
  "mail_settings",
  {
    id: text("id").primaryKey().default("default"),
    enabled: boolean("enabled").notNull().default(false),
    host: text("host").notNull().default(""),
    port: integer("port").notNull().default(587),
    security: mailSecurityEnum("security")
      .$type<MailSecurity>()
      .notNull()
      .default("starttls"),
    username: text("username").notNull().default(""),
    passwordEncrypted: text("password_encrypted"),
    fromName: text("from_name").notNull().default(""),
    fromEmail: text("from_email").notNull().default(""),
    replyTo: text("reply_to").notNull().default(""),
    applicationRecipient: text("application_recipient").notNull().default(""),
    notifyOnPublish: boolean("notify_on_publish").notNull().default(false),
    allowManualPush: boolean("allow_manual_push").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("mail_settings_singleton_check", sql`${table.id} = 'default'`),
  ],
);

/**
 * Durable, per-recipient outbox. A worker leases rows with SKIP LOCKED before contacting SMTP.
 * Recipient/message contents stay in the database only; no diagnostic column contains SMTP errors.
 */
export const mailJobs = pgTable(
  "mail_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    dedupeKey: text("dedupe_key").notNull(),
    kind: mailJobKindEnum("kind").$type<MailKind>().notNull(),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    htmlBody: text("html_body"),
    metadata: jsonb("metadata")
      .$type<MailMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: mailJobStatusEnum("status")
      .$type<MailJobStatus>()
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("mail_jobs_attempts_nonnegative_check", sql`${table.attempts} >= 0`),
    uniqueIndex("mail_jobs_dedupe_key_unique").on(table.dedupeKey),
    index("mail_jobs_pending_index").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    index("mail_jobs_lock_index").on(table.status, table.lockedAt),
  ],
);

export type MailSettingsRow = typeof mailSettings.$inferSelect;
export type MailJobRow = typeof mailJobs.$inferSelect;
