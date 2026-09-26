import { describe, expect, it, vi } from "vitest";

import type { MailDeliveryConfig } from "@/lib/mail/config";
import type { MailJob } from "@/lib/mail/queue";
import type { MailMessage } from "@/lib/mail/transport";
import {
  claimDueMailJobs,
  genericMailError,
  runMailWorkerBatch,
  shouldSuppressMailJob,
  type MailTransportFactory,
  type MailWorkerStore,
} from "@/lib/mail/worker";
import type { MailJobRow } from "@/lib/db/mail-schema";

const now = new Date("2026-09-26T12:00:00.000Z");
const smtpConfig: MailDeliveryConfig = {
  host: "smtp.example.test",
  port: 465,
  security: "tls",
  username: "mailer@example.test",
  password: "smtp-config-secret",
  fromName: "Darwin Journal",
  fromEmail: "mailer@example.test",
  replyTo: "reply@example.test",
};

function job(overrides: Partial<MailJob> = {}): MailJob {
  return {
    id: "e01e4993-dfce-4f43-8b22-4c3e39d2d379",
    dedupeKey: "test:one",
    to: "to@example.test",
    subject: "SMTP worker test",
    text: "test mail body",
    html: null,
    kind: "test",
    metadata: {},
    status: "processing",
    attempts: 0,
    nextAttemptAt: now,
    lockedAt: now,
    lockedBy: "worker-test",
    lastError: null,
    sentAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function storeFor(jobs: MailJob[]) {
  const sent: MailJob[] = [];
  const retries: Array<{ job: MailJob; error: string; exhausted: boolean }> =
    [];
  const suppressed: Array<{ job: MailJob; reason: string }> = [];
  const released: MailJob[] = [];
  const store: MailWorkerStore = {
    claim: vi.fn(async () => jobs),
    isLeaseActive: vi.fn(async () => true),
    markSent: vi.fn(async (current: MailJob) => {
      sent.push(current);
    }),
    markRetry: vi.fn(
      async (
        current: MailJob,
        _workerId,
        error: string,
        _nextAttemptAt,
        exhausted: boolean,
      ) => {
        retries.push({ job: current, error, exhausted });
      },
    ),
    release: vi.fn(async (current: MailJob) => {
      released.push(current);
    }),
    markSuppressed: vi.fn(
      async (current: MailJob, _workerId, reason: string) => {
        suppressed.push({ job: current, reason });
      },
    ),
  };
  return { store, sent, retries, suppressed, released };
}

function stringFragments(value: unknown, seen = new Set<unknown>()): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => stringFragments(item, seen)).join(" ");
  return Object.values(value as Record<string, unknown>)
    .map((item) => stringFragments(item, seen))
    .join(" ");
}

describe("durable SMTP worker", () => {
  it("claims with a transactional SKIP LOCKED lease and maps returned rows", async () => {
    const raw: MailJobRow = {
      id: "e01e4993-dfce-4f43-8b22-4c3e39d2d379",
      dedupeKey: "post:one:subscriber",
      kind: "post",
      recipient: "to@example.test",
      subject: "Post",
      textBody: "body",
      htmlBody: null,
      metadata: {
        subscriberId: "c1a49431-e4fc-4b13-8bb1-1a72d5ee2470",
        documentId: "73e440e0-3215-4d11-a9b2-b98bb0731755",
      },
      status: "processing",
      attempts: 0,
      nextAttemptAt: now,
      lockedAt: now,
      lockedBy: "claim-worker",
      lastError: null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const statements: unknown[] = [];
    const client = {
      transaction: async (
        callback: (tx: {
          execute: (query: unknown) => Promise<MailJobRow[]>;
        }) => Promise<MailJob[]>,
      ) =>
        callback({
          execute: async (query) => {
            statements.push(query);
            return statements.length === 1 ? [] : [raw];
          },
        }),
    };

    const claimed = await claimDueMailJobs(client as never, {
      workerId: "claim-worker",
      limit: 999,
      now,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      dedupeKey: raw.dedupeKey,
      to: raw.recipient,
      status: "processing",
    });
    expect(statements).toHaveLength(2);
    expect(stringFragments(statements[1])).toContain("FOR UPDATE SKIP LOCKED");
    expect(stringFragments(statements[1])).toContain('"locked_by"');
  });

  it("sends a claimed job only through an injected transport and records success", async () => {
    const fixture = storeFor([job()]);
    const delivered: MailMessage[] = [];
    const transportFactory: MailTransportFactory = {
      create: () => ({
        sendMail: async (message) => void delivered.push(message),
      }),
    };

    const result = await runMailWorkerBatch({
      store: fixture.store,
      loadConfig: async () => smtpConfig,
      transportFactory,
      shouldSuppress: async () => null,
      now: () => now,
      workerId: "worker-test",
    });

    expect(result).toMatchObject({
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
    });
    expect(fixture.sent).toHaveLength(1);
    expect(delivered).toEqual([
      expect.objectContaining({
        to: "to@example.test",
        text: "test mail body",
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    ]);
  });

  it("uses a generic retry code without leaking SMTP error contents", async () => {
    const fixture = storeFor([job()]);
    const secret = "smtp-secret-that-must-never-appear-in-a-job";
    const transportFactory: MailTransportFactory = {
      create: () => ({
        sendMail: async () => {
          throw Object.assign(new Error(`TLS failed while using ${secret}`), {
            code: "ETLS",
          });
        },
      }),
    };

    const result = await runMailWorkerBatch({
      store: fixture.store,
      loadConfig: async () => smtpConfig,
      transportFactory,
      shouldSuppress: async () => null,
      now: () => now,
      workerId: "worker-test",
    });

    expect(result).toMatchObject({ retried: 1, sent: 0 });
    expect(fixture.retries).toEqual([
      { job: job(), error: "SMTP_TLS_FAILED", exhausted: false },
    ]);
    expect(JSON.stringify(fixture.retries)).not.toContain(secret);
    expect(
      genericMailError(
        Object.assign(new Error("password=x"), { code: "EAUTH" }),
      ),
    ).toBe("SMTP_AUTH_FAILED");
  });

  it("fails closed before SMTP for jobs missing their revocation references", async () => {
    expect(
      await shouldSuppressMailJob(job({ kind: "post", metadata: {} })),
    ).toBe("DELIVERY_REFERENCE_INVALID");
    expect(
      await shouldSuppressMailJob(
        job({ kind: "application-copy", metadata: {} }),
      ),
    ).toBe("DELIVERY_REFERENCE_INVALID");
    expect(
      await shouldSuppressMailJob(
        job({ kind: "application-notification", metadata: {} }),
      ),
    ).toBe("DELIVERY_REFERENCE_INVALID");
  });

  it("suppresses ineligible work without creating a transport", async () => {
    const fixture = storeFor([
      job({ kind: "post", metadata: { subscriberId: "x", documentId: "y" } }),
    ]);
    const create = vi.fn<MailTransportFactory["create"]>();

    const result = await runMailWorkerBatch({
      store: fixture.store,
      loadConfig: async () => smtpConfig,
      transportFactory: { create },
      shouldSuppress: async () => "RECIPIENT_UNSUBSCRIBED",
      now: () => now,
      workerId: "worker-test",
    });

    expect(result).toMatchObject({ suppressed: 1, sent: 0 });
    expect(fixture.suppressed[0]).toMatchObject({
      reason: "RECIPIENT_UNSUBSCRIBED",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not open SMTP after a concurrent revocation clears the claimed lease", async () => {
    const fixture = storeFor([job()]);
    fixture.store.isLeaseActive = vi.fn(async () => false);
    const create = vi.fn<MailTransportFactory["create"]>();

    const result = await runMailWorkerBatch({
      store: fixture.store,
      loadConfig: async () => smtpConfig,
      transportFactory: { create },
      shouldSuppress: async () => null,
      now: () => now,
      workerId: "worker-test",
    });

    expect(result).toMatchObject({ suppressed: 1, sent: 0 });
    expect(create).not.toHaveBeenCalled();
  });
});
