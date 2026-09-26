import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import type {
  EnqueueMailInput,
  MailKind,
  MailMetadata,
  MailJobStatus,
} from "./types";
import { assertDatabaseConfigured, db } from "@/lib/db";
import { mailJobs, mailSettings, type MailJobRow } from "@/lib/db/mail-schema";

const mailKinds = [
  "subscription-confirm",
  "post",
  "application-copy",
  "application-notification",
  "test",
] as const satisfies readonly MailKind[];

const safeHeader = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label}不能为空。`)
    .max(max, `${label}过长。`)
    .refine((value) => !/[\r\n]/.test(value), `${label}不能包含换行符。`);

const queueInputSchema = z
  .object({
    dedupeKey: safeHeader("去重键", 512),
    to: z
      .string()
      .trim()
      .max(320, "收件人邮箱过长。")
      .email("收件人邮箱无效。"),
    subject: safeHeader("邮件主题", 500),
    text: z.string().max(1_000_000, "邮件正文过长。"),
    html: z.string().max(1_000_000, "邮件 HTML 过长。").optional(),
    kind: z.enum(mailKinds),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export class MailQueueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailQueueValidationError";
  }
}

export type MailJob = {
  id: string;
  dedupeKey: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  kind: MailKind;
  metadata: MailMetadata;
  status: MailJobStatus;
  attempts: number;
  nextAttemptAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** `created` distinguishes a new job from a harmless deduplication hit. */
export type MailEnqueueResult = {
  job: MailJob;
  created: boolean;
};

export type MailQueueDatabase =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function toDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error("Mail job timestamp is invalid.");
  }
  return date;
}

function toNullableDate(value: unknown): Date | null {
  return value === null ? null : toDate(value);
}

function toMailJob(row: MailJobRow): MailJob {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    to: row.recipient,
    subject: row.subject,
    text: row.textBody,
    html: row.htmlBody,
    kind: row.kind,
    metadata: row.metadata,
    status: row.status,
    attempts: row.attempts,
    // Typed Drizzle selects map timestamptz to Date, while a raw `RETURNING` query yields
    // postgres.js strings. Normalize both paths at the queue boundary.
    nextAttemptAt: toDate(row.nextAttemptAt),
    lockedAt: toNullableDate(row.lockedAt),
    lockedBy: row.lockedBy,
    lastError: row.lastError,
    sentAt: toNullableDate(row.sentAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

/** Validate queue input before a transaction can persist any message data. */
export function validateEnqueueMailInput(
  input: EnqueueMailInput,
): EnqueueMailInput {
  const parsed = queueInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new MailQueueValidationError(
      parsed.error.issues[0]?.message ?? "邮件任务无效。",
    );
  }

  return {
    ...parsed.data,
    to: parsed.data.to.toLowerCase(),
    metadata: (parsed.data.metadata ?? {}) as MailMetadata,
  };
}

/**
 * Insert a single durable, per-recipient outbox row in the caller's transaction.
 * The current configuration is checked in the same transaction so an unconfigured site never
 * accumulates a surprise backlog. Duplicate calls return the original row instead of sending twice.
 */
export async function enqueueMail(
  tx: MailQueueDatabase,
  input: EnqueueMailInput,
): Promise<MailEnqueueResult | null> {
  assertDatabaseConfigured();
  const value = validateEnqueueMailInput(input);
  const [settings] = await tx
    .select({ enabled: mailSettings.enabled })
    .from(mailSettings)
    .where(eq(mailSettings.id, "default"))
    .limit(1);

  if (!settings?.enabled) return null;

  const [inserted] = await tx
    .insert(mailJobs)
    .values({
      dedupeKey: value.dedupeKey,
      recipient: value.to,
      subject: value.subject,
      textBody: value.text,
      htmlBody: value.html,
      kind: value.kind,
      metadata: value.metadata ?? {},
    })
    .onConflictDoNothing({ target: mailJobs.dedupeKey })
    .returning();

  if (inserted) return { job: toMailJob(inserted), created: true };

  const [existing] = await tx
    .select()
    .from(mailJobs)
    .where(eq(mailJobs.dedupeKey, value.dedupeKey))
    .limit(1);
  if (!existing) {
    // A concurrent transaction that loses its insert race should be visible after it commits;
    // callers can safely retry their encompassing transaction rather than risking duplicate mail.
    throw new Error("Mail queue deduplication race.");
  }
  return { job: toMailJob(existing), created: false };
}

export { toMailJob };
