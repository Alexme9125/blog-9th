import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { claimDueMailJobs } from "@/lib/mail/worker";
import { mailJobs } from "@/lib/db/mail-schema";
import * as schema from "@/lib/db/schema";

const runId = randomUUID().replaceAll("-", "");
const testDatabaseName = `darwin_mail_outbox_test_${runId}`;

function configuredDatabaseUrl(): string | undefined {
  if (
    !process.env.DATABASE_URL &&
    existsSync(resolve(process.cwd(), ".env.local"))
  ) {
    process.loadEnvFile(resolve(process.cwd(), ".env.local"));
  }
  return process.env.DATABASE_URL?.trim() || undefined;
}

function databaseUrlFor(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

const sourceDatabaseUrl = configuredDatabaseUrl();
const databaseDescribe = sourceDatabaseUrl ? describe : describe.skip;

databaseDescribe("mail outbox PostgreSQL integration", () => {
  let controlSql: Sql | undefined;
  let testSql: Sql | undefined;
  let lockSql: Sql | undefined;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    if (!sourceDatabaseUrl)
      throw new Error(
        "DATABASE_URL is required for mail outbox integration tests.",
      );
    controlSql = postgres(databaseUrlFor(sourceDatabaseUrl, "postgres"), {
      max: 1,
      prepare: false,
    });
    await controlSql.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    const testDatabaseUrl = databaseUrlFor(sourceDatabaseUrl, testDatabaseName);
    testSql = postgres(testDatabaseUrl, { max: 1, prepare: false });
    lockSql = postgres(testDatabaseUrl, { max: 1, prepare: false });
    testDb = drizzle({ client: testSql, schema });
    await migrate(testDb, {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
  });

  afterAll(async () => {
    if (lockSql) await lockSql.end({ timeout: 5 });
    if (testSql) await testSql.end({ timeout: 5 });
    if (controlSql) {
      await controlSql.unsafe(
        `DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`,
      );
      await controlSql.end({ timeout: 5 });
    }
  });

  it("uses real SKIP LOCKED leases, restores stale leases, and parses returned timestamps as Dates", async () => {
    const fixedNow = new Date("2026-09-26T12:00:00.000Z");
    const lockedId = randomUUID();
    const freeId = randomUUID();
    await testDb.insert(mailJobs).values([
      {
        id: lockedId,
        dedupeKey: `locked:${runId}`,
        kind: "test",
        recipient: "locked@example.test",
        subject: "locked",
        textBody: "locked body",
        status: "queued",
        nextAttemptAt: new Date(fixedNow.getTime() - 10_000),
      },
      {
        id: freeId,
        dedupeKey: `free:${runId}`,
        kind: "test",
        recipient: "free@example.test",
        subject: "free",
        textBody: "free body",
        status: "queued",
        nextAttemptAt: new Date(fixedNow.getTime() - 5_000),
      },
    ]);

    if (!lockSql) throw new Error("Lock connection was not initialized.");
    await lockSql.begin(async (tx) => {
      await tx`SELECT "id" FROM "mail_jobs" WHERE "id" = ${lockedId}::uuid FOR UPDATE`;
      const claimed = await claimDueMailJobs(testDb as never, {
        workerId: "postgres-worker",
        limit: 1,
        now: fixedNow,
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.id).toBe(freeId);
      expect(claimed[0]?.nextAttemptAt).toBeInstanceOf(Date);
      expect(claimed[0]?.lockedAt).toBeInstanceOf(Date);
      expect(claimed[0]?.createdAt).toBeInstanceOf(Date);
    });

    await testDb
      .update(mailJobs)
      .set({ nextAttemptAt: new Date(fixedNow.getTime() + 60 * 60 * 1000) })
      .where(eq(mailJobs.id, lockedId));

    const staleId = randomUUID();
    await testDb.insert(mailJobs).values({
      id: staleId,
      dedupeKey: `stale:${runId}`,
      kind: "test",
      recipient: "stale@example.test",
      subject: "stale",
      textBody: "stale body",
      status: "processing",
      lockedBy: "crashed-worker",
      lockedAt: new Date(fixedNow.getTime() - 5_000),
      nextAttemptAt: new Date(fixedNow.getTime() - 5_000),
    });

    const recovered = await claimDueMailJobs(testDb as never, {
      workerId: "recovery-worker",
      limit: 1,
      now: fixedNow,
      lockTimeoutMs: 1_000,
    });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      id: staleId,
      status: "processing",
      lockedBy: "recovery-worker",
    });
    expect(recovered[0]?.lockedAt).toBeInstanceOf(Date);
  });
});
