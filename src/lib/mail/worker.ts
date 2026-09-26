import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { getMailDeliveryConfig, type MailDeliveryConfig } from "./config";
import { toMailJob, type MailJob } from "./queue";
import {
  createSmtpTransport,
  type MailMessage,
  type MailTransport,
} from "./transport";
import { assertDatabaseConfigured, db } from "@/lib/db";
import { mailJobs, type MailJobRow } from "@/lib/db/mail-schema";

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 3;
const MAX_BATCH_SIZE = 50;
const MAX_CONCURRENCY = 5;
const SEND_TIMEOUT_MS = 15_000;
// A lease must outlive the worst permitted 50-job / one-at-a-time batch (plus a safety margin).
// This avoids another process reclaiming a job that was leased but has not begun its bounded send.
const LOCK_TIMEOUT_MS = MAX_BATCH_SIZE * SEND_TIMEOUT_MS + 60_000;
const PAUSE_WHEN_DISABLED_MS = 60_000;
const MAX_ATTEMPTS = 8;
const WORKER_INTERVAL_MS = 15_000;

export type { MailMessage, MailTransport } from "./transport";

export type MailTransportFactory = {
  create(config: MailDeliveryConfig): MailTransport;
};

export type MailWorkerStore = {
  claim(workerId: string, limit: number, now: Date): Promise<MailJob[]>;
  /** A revocation action can clear a lease after it was claimed; check again immediately before SMTP. */
  isLeaseActive(job: MailJob, workerId: string): Promise<boolean>;
  markSent(job: MailJob, workerId: string, now: Date): Promise<void>;
  markRetry(
    job: MailJob,
    workerId: string,
    error: string,
    nextAttemptAt: Date,
    exhausted: boolean,
  ): Promise<void>;
  release(job: MailJob, workerId: string, nextAttemptAt: Date): Promise<void>;
  markSuppressed(job: MailJob, workerId: string, reason: string): Promise<void>;
};

export type MailWorkerDependencies = {
  store: MailWorkerStore;
  loadConfig: () => Promise<MailDeliveryConfig | null>;
  transportFactory: MailTransportFactory;
  shouldSuppress: (job: MailJob) => Promise<string | null>;
  now?: () => Date;
  workerId?: string;
  batchSize?: number;
  concurrency?: number;
  sendTimeoutMs?: number;
};

export type MailWorkerResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
  paused: number;
};

type MailDatabase = Pick<typeof db, "transaction">;

function clamp(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || !value) return fallback;
  return Math.max(1, Math.min(Math.floor(value), maximum));
}

function delayForAttempt(attempt: number): number {
  return Math.min(60 * 60 * 1000, 10_000 * 2 ** Math.max(0, attempt - 1));
}

function genericMailError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code).toUpperCase()
      : "";
  if (code === "EAUTH" || code === "ENOAUTH") return "SMTP_AUTH_FAILED";
  if (code === "ETLS" || code === "EREQUIRETLS") return "SMTP_TLS_FAILED";
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "SMTP_TIMEOUT";
  if (code === "ECONNECTION" || code === "ECONNREFUSED" || code === "EDNS")
    return "SMTP_CONNECTION_FAILED";
  return "SMTP_DELIVERY_FAILED";
}

function timeoutError(): Error & { code: string } {
  const error = new Error("SMTP send timed out.");
  error.name = "MailSendTimeoutError";
  Object.assign(error, { code: "ETIMEDOUT" });
  return error as Error & { code: string };
}

async function withTimeout<T>(
  value: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([value, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mailMessage(job: MailJob, config: MailDeliveryConfig): MailMessage {
  return {
    from: config.fromName
      ? { name: config.fromName, address: config.fromEmail }
      : config.fromEmail,
    to: job.to,
    subject: job.subject,
    text: job.text,
    ...(job.html ? { html: job.html } : {}),
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    // A deterministic Message-ID helps compliant SMTP providers recognize a retry after a crash.
    messageId: `<${job.id}@darwin-mail.local>`,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export const smtpTransportFactory: MailTransportFactory = {
  create: createSmtpTransport,
};

function selectColumns() {
  return sql`
    job."id",
    job."dedupe_key" AS "dedupeKey",
    job."kind",
    job."recipient",
    job."subject",
    job."text_body" AS "textBody",
    job."html_body" AS "htmlBody",
    job."metadata",
    job."status",
    job."attempts",
    job."next_attempt_at" AS "nextAttemptAt",
    job."locked_at" AS "lockedAt",
    job."locked_by" AS "lockedBy",
    job."last_error" AS "lastError",
    job."sent_at" AS "sentAt",
    job."created_at" AS "createdAt",
    job."updated_at" AS "updatedAt"
  `;
}

// postgres.js does not serialize Date values passed through an untyped raw `sql` template.
// Keep the UTC offset and cast explicitly so raw lease queries work with the same driver as
// the typed Drizzle updates below.
function timestampParameter(value: Date) {
  return sql`${value.toISOString()}::timestamptz`;
}

/**
 * Atomically lease due jobs. SKIP LOCKED allows multiple server instances to run workers without
 * double-sending a row. A bounded stale-lease recovery makes process crashes retryable.
 */
export async function claimDueMailJobs(
  client: MailDatabase = db,
  options: {
    workerId: string;
    limit?: number;
    now?: Date;
    lockTimeoutMs?: number;
  },
): Promise<MailJob[]> {
  const limit = clamp(options.limit, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
  const now = options.now ?? new Date();
  const staleBefore = new Date(
    now.getTime() - (options.lockTimeoutMs ?? LOCK_TIMEOUT_MS),
  );

  const rows = await client.transaction(async (tx) => {
    await tx.execute(sql`
      WITH stale AS (
        SELECT "id"
        FROM "mail_jobs"
        WHERE "status" = 'processing' AND "locked_at" < ${timestampParameter(staleBefore)}
        ORDER BY "locked_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "mail_jobs" AS job
      SET "status" = 'queued', "locked_at" = NULL, "locked_by" = NULL, "next_attempt_at" = ${timestampParameter(now)}, "updated_at" = ${timestampParameter(now)}
      FROM stale
      WHERE job."id" = stale."id"
    `);

    return tx.execute<MailJobRow>(sql`
      WITH candidates AS (
        SELECT "id"
        FROM "mail_jobs"
        WHERE "status" = 'queued' AND "next_attempt_at" <= ${timestampParameter(now)}
        ORDER BY "next_attempt_at" ASC, "created_at" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "mail_jobs" AS job
      SET "status" = 'processing', "locked_at" = ${timestampParameter(now)}, "locked_by" = ${options.workerId}, "updated_at" = ${timestampParameter(now)}
      FROM candidates
      WHERE job."id" = candidates."id"
      RETURNING ${selectColumns()}
    `);
  });

  return (rows as MailJobRow[]).map(toMailJob);
}

function activeLeaseWhere(job: MailJob, workerId: string) {
  return and(
    eq(mailJobs.id, job.id),
    eq(mailJobs.status, "processing"),
    eq(mailJobs.lockedBy, workerId),
  );
}

export const databaseMailWorkerStore: MailWorkerStore = {
  claim: (workerId, limit, now) =>
    claimDueMailJobs(db, { workerId, limit, now }),
  async isLeaseActive(job, workerId) {
    const [active] = await db
      .select({ id: mailJobs.id })
      .from(mailJobs)
      .where(activeLeaseWhere(job, workerId))
      .limit(1);
    return Boolean(active);
  },
  async markSent(job, workerId, now) {
    await db
      .update(mailJobs)
      .set({
        status: "sent",
        attempts: job.attempts + 1,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        sentAt: now,
        updatedAt: now,
      })
      .where(activeLeaseWhere(job, workerId));
  },
  async markRetry(job, workerId, error, nextAttemptAt, exhausted) {
    const now = new Date();
    await db
      .update(mailJobs)
      .set({
        status: exhausted ? "failed" : "queued",
        attempts: job.attempts + 1,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt,
        lastError: error,
        updatedAt: now,
      })
      .where(activeLeaseWhere(job, workerId));
  },
  async release(job, workerId, nextAttemptAt) {
    await db
      .update(mailJobs)
      .set({
        status: "queued",
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt,
        updatedAt: new Date(),
      })
      .where(activeLeaseWhere(job, workerId));
  },
  async markSuppressed(job, workerId, reason) {
    await db
      .update(mailJobs)
      .set({
        status: "suppressed",
        lockedAt: null,
        lockedBy: null,
        lastError: reason,
        updatedAt: new Date(),
      })
      .where(activeLeaseWhere(job, workerId));
  },
};

function asUuid(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

async function exists(query: ReturnType<typeof sql>): Promise<boolean> {
  const rows = await db.execute<{ eligible: boolean }>(query);
  return Boolean(rows[0]?.eligible);
}

/** Re-check revocable community state immediately before delivery, after the job has been leased. */
export async function shouldSuppressMailJob(
  job: MailJob,
): Promise<string | null> {
  if (job.kind === "post") {
    const subscriberId = asUuid(job.metadata.subscriberId);
    const documentId = asUuid(job.metadata.documentId);
    if (!subscriberId || !documentId) return "DELIVERY_REFERENCE_INVALID";
    const subscriberEligible = await exists(sql`
      SELECT EXISTS(
        SELECT 1 FROM "community_subscribers"
        WHERE "id" = ${subscriberId}::uuid
          AND "status" = 'confirmed'
          AND "unsubscribed_at" IS NULL
      ) AS "eligible"
    `);
    if (!subscriberEligible) return "RECIPIENT_UNSUBSCRIBED";

    const postEligible = await exists(sql`
      SELECT EXISTS(
        SELECT 1 FROM "documents"
        WHERE "id" = ${documentId}::uuid
          AND "kind" = 'post'
          AND "published" IS NOT NULL
          AND "published_slug" IS NOT NULL
          AND "published_at" IS NOT NULL
          AND "deleted_at" IS NULL
          AND "status" <> 'archived'
      ) AS "eligible"
    `);
    if (!postEligible) return "POST_NO_LONGER_PUBLISHED";
  }

  if (
    job.kind === "application-copy" ||
    job.kind === "application-notification"
  ) {
    const applicationId = asUuid(job.metadata.applicationId);
    if (!applicationId) return "DELIVERY_REFERENCE_INVALID";
    const isVerification =
      job.kind === "application-copy" &&
      job.metadata.applicationEmailPurpose === "verification";
    const eligible = await exists(sql`
      SELECT EXISTS(
        SELECT 1 FROM "community_applications"
        WHERE "id" = ${applicationId}::uuid
          AND "status" <> 'withdrawn'
          AND (${isVerification} OR "email_verified_at" IS NOT NULL)
      ) AS "eligible"
    `);
    if (!eligible) return "APPLICATION_WITHDRAWN";
  }

  return null;
}

async function closeTransport(transport: MailTransport): Promise<void> {
  try {
    await transport.close?.();
  } catch {
    // Closing an already-broken connection should not change an accepted delivery's state.
  }
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        await run(items[index]!);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Execute one bounded batch. It is injectable so tests use only transport mocks, never a real
 * SMTP provider. The production wrapper below supplies the database and Nodemailer transport.
 */
export async function runMailWorkerBatch(
  dependencies: MailWorkerDependencies,
): Promise<MailWorkerResult> {
  const now = dependencies.now ?? (() => new Date());
  const workerId = dependencies.workerId ?? randomUUID();
  const batchSize = clamp(
    dependencies.batchSize,
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
  );
  const concurrency = clamp(
    dependencies.concurrency,
    DEFAULT_CONCURRENCY,
    MAX_CONCURRENCY,
  );
  const timeout = clamp(
    dependencies.sendTimeoutMs,
    SEND_TIMEOUT_MS,
    SEND_TIMEOUT_MS,
  );
  const jobs = await dependencies.store.claim(workerId, batchSize, now());
  const result: MailWorkerResult = {
    claimed: jobs.length,
    sent: 0,
    retried: 0,
    failed: 0,
    suppressed: 0,
    paused: 0,
  };
  if (!jobs.length) return result;

  let config: MailDeliveryConfig | null;
  try {
    config = await dependencies.loadConfig();
  } catch {
    config = null;
    await runBounded(jobs, concurrency, async (job) => {
      const attempts = job.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await dependencies.store.markRetry(
        job,
        workerId,
        "SMTP_CONFIGURATION_UNAVAILABLE",
        new Date(now().getTime() + delayForAttempt(attempts)),
        exhausted,
      );
      if (exhausted) result.failed += 1;
      else result.retried += 1;
    });
    return result;
  }

  if (!config) {
    await runBounded(jobs, concurrency, async (job) => {
      await dependencies.store.release(
        job,
        workerId,
        new Date(now().getTime() + PAUSE_WHEN_DISABLED_MS),
      );
      result.paused += 1;
    });
    return result;
  }

  await runBounded(jobs, concurrency, async (job) => {
    try {
      const suppression = await dependencies.shouldSuppress(job);
      if (suppression) {
        await dependencies.store.markSuppressed(job, workerId, suppression);
        result.suppressed += 1;
        return;
      }

      // Community revocation/unpublish actions can atomically suppress a queued or leased row.
      // Do this final lease read immediately before opening an SMTP connection.
      if (!(await dependencies.store.isLeaseActive(job, workerId))) {
        result.suppressed += 1;
        return;
      }

      const transport = dependencies.transportFactory.create(config);
      try {
        await withTimeout(
          transport.sendMail(mailMessage(job, config)),
          timeout,
        );
      } finally {
        await closeTransport(transport);
      }
      await dependencies.store.markSent(job, workerId, now());
      result.sent += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await dependencies.store.markRetry(
        job,
        workerId,
        genericMailError(error),
        new Date(now().getTime() + delayForAttempt(attempts)),
        exhausted,
      );
      if (exhausted) result.failed += 1;
      else result.retried += 1;
    }
  });

  return result;
}

/** Production entrypoint. It uses the shared database pool and never logs message/credential data. */
export async function processMailBatch(): Promise<MailWorkerResult> {
  assertDatabaseConfigured();
  return runMailWorkerBatch({
    store: databaseMailWorkerStore,
    loadConfig: getMailDeliveryConfig,
    transportFactory: smtpTransportFactory,
    shouldSuppress: shouldSuppressMailJob,
  });
}

let inFlight: Promise<MailWorkerResult> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;

function isBuildOrTest(environment: NodeJS.ProcessEnv): boolean {
  return (
    environment.NODE_ENV === "test" ||
    environment.VITEST !== undefined ||
    environment.NEXT_PHASE === "phase-production-build"
  );
}

/** A request can nudge a bounded batch, but never starts a timer during tests/builds. */
export function kickMailWorker(): void {
  if (isBuildOrTest(process.env) || inFlight) return;
  inFlight = processMailBatch()
    .catch(() => ({
      claimed: 0,
      sent: 0,
      retried: 0,
      failed: 0,
      suppressed: 0,
      paused: 0,
    }))
    .finally(() => {
      inFlight = undefined;
    });
}

/** Next instrumentation calls this once per production Node server instance. */
export function startMailWorker(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (
    interval ||
    environment.NODE_ENV !== "production" ||
    environment.NEXT_RUNTIME !== "nodejs" ||
    isBuildOrTest(environment)
  ) {
    return;
  }

  kickMailWorker();
  interval = setInterval(kickMailWorker, WORKER_INTERVAL_MS);
  interval.unref?.();
}

export { genericMailError, mailMessage, delayForAttempt };
