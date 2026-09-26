import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AdminUser } from "@/lib/cms/types";
import type { MailSettingsInput } from "@/lib/mail/types";
import * as schema from "@/lib/db/schema";

const runId = randomUUID().replaceAll("-", "");
const testDatabaseName = `darwin_mail_actions_test_${runId}`;
const mailTestSecret =
  "mail-actions-encryption-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const mutableEnvironment = process.env as Record<string, string | undefined>;
const originalEnvironment = {
  databaseUrl: process.env.DATABASE_URL,
  betterAuthSecret: process.env.BETTER_AUTH_SECRET,
  nodeEnv: process.env.NODE_ENV,
};

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

function actionError(code: "FORBIDDEN" | "PASSWORD_CHANGE_REQUIRED") {
  return Object.assign(new Error(code), { code });
}

const sourceDatabaseUrl = configuredDatabaseUrl();
const databaseDescribe = sourceDatabaseUrl ? describe : describe.skip;

const admin: AdminUser = {
  id: `mail-admin-${runId}`,
  name: "Mail Test Admin",
  email: `mail-admin-${runId}@example.test`,
  role: "admin",
  disabled: false,
  mustChangePassword: false,
};
const editor: AdminUser = {
  id: `mail-editor-${runId}`,
  name: "Mail Test Editor",
  email: `mail-editor-${runId}@example.test`,
  role: "editor",
  disabled: false,
  mustChangePassword: false,
};
const author: AdminUser = {
  id: `mail-author-${runId}`,
  name: "Mail Test Author",
  email: `mail-author-${runId}@example.test`,
  role: "author",
  disabled: false,
  mustChangePassword: false,
};

let currentUser: AdminUser | null = null;

async function requireCurrentUser(): Promise<AdminUser> {
  if (!currentUser) throw actionError("FORBIDDEN");
  return currentUser;
}

async function requireCurrentRole(
  roles: AdminUser["role"][],
): Promise<AdminUser> {
  const user = await requireCurrentUser();
  if (!roles.includes(user.role)) throw actionError("FORBIDDEN");
  return user;
}

async function requireCurrentMutationUser(
  roles?: AdminUser["role"][],
): Promise<AdminUser> {
  const user = roles
    ? await requireCurrentRole(roles)
    : await requireCurrentUser();
  if (user.mustChangePassword) throw actionError("PASSWORD_CHANGE_REQUIRED");
  return user;
}

function settingsInput(password?: string): MailSettingsInput {
  return {
    enabled: true,
    host: "smtp.example.test",
    port: 587,
    security: "starttls",
    username: "mailer@example.test",
    ...(password === undefined ? {} : { password }),
    fromName: "Darwin Journal",
    fromEmail: "mailer@example.test",
    replyTo: "reply@example.test",
    applicationRecipient: "applications@example.test",
    notifyOnPublish: false,
    allowManualPush: true,
  };
}

databaseDescribe("mail server actions", () => {
  let controlSql: Sql | undefined;
  let testSql: Sql | undefined;
  let serviceSql: Sql | undefined;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;
  let actions: typeof import("@/lib/mail/actions");

  const requireTestDb = () => {
    if (!testDb) throw new Error("Test database was not initialized.");
    return testDb;
  };

  beforeAll(async () => {
    if (!sourceDatabaseUrl) {
      throw new Error(
        "DATABASE_URL is required for mail action integration tests.",
      );
    }
    controlSql = postgres(databaseUrlFor(sourceDatabaseUrl, "postgres"), {
      max: 1,
      prepare: false,
    });
    await controlSql.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    const testDatabaseUrl = databaseUrlFor(sourceDatabaseUrl, testDatabaseName);
    testSql = postgres(testDatabaseUrl, { max: 1, prepare: false });
    testDb = drizzle({ client: testSql, schema });
    await migrate(testDb, {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });

    mutableEnvironment.DATABASE_URL = testDatabaseUrl;
    mutableEnvironment.BETTER_AUTH_SECRET = mailTestSecret;
    mutableEnvironment.NODE_ENV = "test";
    vi.doMock("@/lib/auth/server", () => ({
      requireRole: requireCurrentRole,
      requireMutationUser: requireCurrentMutationUser,
    }));
    vi.resetModules();

    const [database, actionModule] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/mail/actions"),
    ]);
    serviceSql = database.sql;
    actions = actionModule;

    await requireTestDb().insert(schema.users).values([admin, editor, author]);
  });

  beforeEach(async () => {
    currentUser = admin;
    await requireTestDb().delete(schema.auditLog);
    await requireTestDb().delete(schema.mailJobs);
    await requireTestDb().delete(schema.mailSettings);
  });

  afterAll(async () => {
    currentUser = null;
    if (serviceSql) await serviceSql.end({ timeout: 5 });
    if (testSql) await testSql.end({ timeout: 5 });
    if (controlSql) {
      await controlSql.unsafe(
        `DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`,
      );
      await controlSql.end({ timeout: 5 });
    }
    if (originalEnvironment.databaseUrl === undefined)
      delete mutableEnvironment.DATABASE_URL;
    else mutableEnvironment.DATABASE_URL = originalEnvironment.databaseUrl;
    if (originalEnvironment.betterAuthSecret === undefined)
      delete mutableEnvironment.BETTER_AUTH_SECRET;
    else
      mutableEnvironment.BETTER_AUTH_SECRET =
        originalEnvironment.betterAuthSecret;
    if (originalEnvironment.nodeEnv === undefined)
      delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = originalEnvironment.nodeEnv;
    vi.doUnmock("@/lib/auth/server");
    vi.resetModules();
  });

  it("redacts saved credentials, audits only the change, and queues test mail without direct delivery", async () => {
    const smtpPassword = "smtp-password-must-not-appear-in-actions-or-audit";
    const saved = await actions.saveMailSettings(settingsInput(smtpPassword));
    expect(saved).toMatchObject({
      ok: true,
      data: { enabled: true, hasPassword: true },
    });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data).not.toHaveProperty("password");
    expect(saved.data).not.toHaveProperty("passwordEncrypted");
    expect(JSON.stringify(saved)).not.toContain(smtpPassword);

    const [stored] = await requireTestDb()
      .select()
      .from(schema.mailSettings)
      .where(eq(schema.mailSettings.id, "default"));
    expect(stored?.passwordEncrypted).toBeTruthy();
    expect(stored?.passwordEncrypted).not.toContain(smtpPassword);

    const [settingsAudit] = await requireTestDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "mail.settings.save"));
    expect(settingsAudit?.detail).toEqual({ enabled: true });
    expect(JSON.stringify(settingsAudit)).not.toContain(smtpPassword);

    const queued = await actions.testMail({ to: "recipient@example.test" });
    expect(queued).toEqual({ ok: true, data: undefined });
    const [job] = await requireTestDb()
      .select()
      .from(schema.mailJobs)
      .where(eq(schema.mailJobs.kind, "test"));
    expect(job).toMatchObject({
      recipient: "recipient@example.test",
      status: "queued",
      attempts: 0,
    });
    const [testAudit] = await requireTestDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "mail.test.enqueue"));
    expect(testAudit?.detail).toEqual({});
    expect(JSON.stringify(testAudit)).not.toContain("recipient@example.test");

    const read = await actions.getAdminMailSettings();
    expect(read).toMatchObject({ enabled: true, hasPassword: true });
    expect(JSON.stringify(read)).not.toContain(smtpPassword);

    const retained = await actions.saveMailSettings(settingsInput());
    expect(retained).toMatchObject({ ok: true, data: { hasPassword: true } });
    const [afterBlankSave] = await requireTestDb()
      .select()
      .from(schema.mailSettings)
      .where(eq(schema.mailSettings.id, "default"));
    expect(afterBlankSave?.passwordEncrypted).toBeTruthy();
    expect(afterBlankSave?.passwordEncrypted).not.toBe(
      stored?.passwordEncrypted,
    );

    const cleared = await actions.saveMailSettings({
      ...settingsInput(),
      enabled: false,
      clearPassword: true,
    });
    expect(cleared).toMatchObject({ ok: true, data: { hasPassword: false } });
    const [afterExplicitClear] = await requireTestDb()
      .select()
      .from(schema.mailSettings)
      .where(eq(schema.mailSettings.id, "default"));
    expect(afterExplicitClear?.passwordEncrypted).toBeNull();
  });

  it("masks history recipients and lets only an admin retry a failed job", async () => {
    const jobId = randomUUID();
    await requireTestDb()
      .insert(schema.mailJobs)
      .values({
        id: jobId,
        dedupeKey: `failed:${runId}`,
        kind: "test",
        recipient: "recipient@example.test",
        subject: "Retry me",
        textBody: "test body",
        status: "failed",
        attempts: 3,
        lastError: "SMTP_TLS_FAILED",
      });

    const history = await actions.listMailJobs(10);
    expect(history).toEqual([
      expect.objectContaining({
        id: jobId,
        to: "r***@example.test",
        status: "failed",
        attempts: 3,
        lastError: "SMTP_TLS_FAILED",
      }),
    ]);
    expect(JSON.stringify(history)).not.toContain("recipient@example.test");

    expect(await actions.retryMailJob(jobId)).toEqual({
      ok: true,
      data: undefined,
    });
    const [retried] = await requireTestDb()
      .select()
      .from(schema.mailJobs)
      .where(eq(schema.mailJobs.id, jobId));
    expect(retried).toMatchObject({
      status: "queued",
      attempts: 0,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
    });
    const [audit] = await requireTestDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "mail.job.retry"));
    expect(audit?.detail).toEqual({});
  });

  it("rejects every admin mail action for editors and authors", async () => {
    for (const user of [editor, author]) {
      currentUser = user;
      await expect(actions.getAdminMailSettings()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        actions.saveMailSettings(settingsInput("ignored")),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        actions.testMail({ to: "recipient@example.test" }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(actions.listMailJobs()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(actions.retryMailJob(randomUUID())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });

  it("blocks all mail mutations until an admin changes a required password", async () => {
    const jobId = randomUUID();
    await requireTestDb()
      .insert(schema.mailJobs)
      .values({
        id: jobId,
        dedupeKey: `password-change:${runId}`,
        kind: "test",
        recipient: "recipient@example.test",
        subject: "Do not retry",
        textBody: "test body",
        status: "failed",
        attempts: 2,
        lastError: "SMTP_AUTH_FAILED",
      });
    currentUser = { ...admin, mustChangePassword: true };

    await expect(
      actions.saveMailSettings(settingsInput("blocked")),
    ).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    await expect(
      actions.testMail({ to: "recipient@example.test" }),
    ).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    await expect(actions.retryMailJob(jobId)).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });

    const [settings] = await requireTestDb()
      .select()
      .from(schema.mailSettings)
      .where(eq(schema.mailSettings.id, "default"));
    expect(settings).toBeUndefined();
    const [unchanged] = await requireTestDb()
      .select()
      .from(schema.mailJobs)
      .where(eq(schema.mailJobs.id, jobId));
    expect(unchanged).toMatchObject({
      status: "failed",
      attempts: 2,
      lastError: "SMTP_AUTH_FAILED",
    });
    expect(await requireTestDb().select().from(schema.auditLog)).toEqual([]);
  });
});
