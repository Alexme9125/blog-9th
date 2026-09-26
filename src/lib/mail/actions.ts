"use server";

import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  getAdminMailSettings as readAdminMailSettings,
  getPublicMailAvailability as readPublicMailAvailability,
  MailValidationError,
  saveStoredMailSettings,
} from "./config";
import { MailEncryptionError } from "./crypto";
import { enqueueMail } from "./queue";
import type { AdminMailJob, MailSettings, MailSettingsInput } from "./types";
import { kickMailWorker } from "./worker";
import { requireMutationUser, requireRole } from "@/lib/auth/server";
import type { ActionResult } from "@/lib/cms/types";
import { assertDatabaseConfigured, db } from "@/lib/db";
import { auditLog, mailJobs } from "@/lib/db/schema";

const testRecipientSchema = z
  .object({
    to: z
      .string()
      .trim()
      .max(320, "测试邮箱过长。")
      .email("请输入有效的测试邮箱。"),
  })
  .strict();
const jobIdSchema = z.string().uuid("邮件任务标识无效。");

function failure<T = never>(error: string, code: string): ActionResult<T> {
  return { ok: false, error, code };
}

function maskAddress(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return "***";
  const local = value.slice(0, at);
  return `${local.slice(0, 1)}***@${value.slice(at + 1)}`;
}

function toAdminMailJob(row: typeof mailJobs.$inferSelect): AdminMailJob {
  return {
    id: row.id,
    to: maskAddress(row.recipient),
    subject: row.subject,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
  };
}

/** The complete SMTP settings page is an administrator-only read. No password is serialized. */
export async function getAdminMailSettings(): Promise<MailSettings> {
  await requireRole(["admin"]);
  assertDatabaseConfigured();
  return readAdminMailSettings();
}

/** Public pages can tell only whether confirmed subscriptions are currently available. */
export async function getPublicMailAvailability(): Promise<{
  available: boolean;
}> {
  return readPublicMailAvailability();
}

/** Save validated configuration and audit only the fact of the change, never its secrets. */
export async function saveMailSettings(
  input: MailSettingsInput,
): Promise<ActionResult<MailSettings>> {
  const actor = await requireMutationUser(["admin"]);
  assertDatabaseConfigured();

  try {
    const settings = await saveStoredMailSettings(input);
    await db.insert(auditLog).values({
      actorId: actor.id,
      action: "mail.settings.save",
      resourceId: "default",
      detail: { enabled: settings.enabled },
    });
    return { ok: true, data: settings };
  } catch (error) {
    if (error instanceof MailValidationError)
      return failure(error.message, "VALIDATION");
    if (error instanceof MailEncryptionError)
      return failure(
        "无法读取现有 SMTP 密码，请按密钥轮换步骤处理。",
        "CREDENTIAL_UNAVAILABLE",
      );
    return failure("保存 SMTP 设置失败，请稍后重试。", "SAVE_FAILED");
  }
}

/** Queue a one-off test through the same durable outbox path; this action never sends directly. */
export async function testMail(input: { to: string }): Promise<ActionResult> {
  const actor = await requireMutationUser(["admin"]);
  assertDatabaseConfigured();
  const parsed = testRecipientSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      parsed.error.issues[0]?.message ?? "测试邮箱无效。",
      "VALIDATION",
    );

  try {
    const queued = await db.transaction(async (tx) => {
      const result = await enqueueMail(tx, {
        dedupeKey: `test:${randomUUID()}`,
        to: parsed.data.to,
        subject: "Darwin Journal SMTP 测试邮件",
        text: "这是一封通过 Darwin Journal 持久化邮件队列发送的测试邮件。",
        kind: "test",
      });
      if (result?.created) {
        await tx.insert(auditLog).values({
          actorId: actor.id,
          action: "mail.test.enqueue",
          resourceId: result.job.id,
          detail: {},
        });
      }
      return result;
    });

    if (!queued) return failure("请先保存并启用 SMTP 设置。", "DISABLED");
    kickMailWorker();
    return { ok: true, data: undefined };
  } catch {
    return failure("测试邮件加入队列失败，请稍后重试。", "QUEUE_FAILED");
  }
}

/** Admin history intentionally omits message bodies, metadata, raw recipient addresses, and credentials. */
export async function listMailJobs(limit = 30): Promise<AdminMailJob[]> {
  await requireRole(["admin"]);
  assertDatabaseConfigured();
  const normalizedLimit = Number.isInteger(limit)
    ? Math.max(1, Math.min(limit, 100))
    : 30;
  const rows = await db
    .select()
    .from(mailJobs)
    .orderBy(desc(mailJobs.createdAt))
    .limit(normalizedLimit);
  return rows.map(toAdminMailJob);
}

/** A manual retry is restricted to terminal delivery failures; sent/suppressed jobs are never revived. */
export async function retryMailJob(id: string): Promise<ActionResult> {
  const actor = await requireMutationUser(["admin"]);
  assertDatabaseConfigured();
  const parsed = jobIdSchema.safeParse(id);
  if (!parsed.success)
    return failure(
      parsed.error.issues[0]?.message ?? "邮件任务标识无效。",
      "VALIDATION",
    );

  try {
    const [retried] = await db
      .update(mailJobs)
      .set({
        status: "queued",
        attempts: 0,
        nextAttemptAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(mailJobs.id, parsed.data), eq(mailJobs.status, "failed")))
      .returning({ id: mailJobs.id });

    if (!retried)
      return failure("只有发送失败的邮件可以重试。", "NOT_RETRYABLE");
    await db
      .insert(auditLog)
      .values({
        actorId: actor.id,
        action: "mail.job.retry",
        resourceId: retried.id,
        detail: {},
      });
    kickMailWorker();
    return { ok: true, data: undefined };
  } catch {
    return failure("邮件重试失败，请稍后重试。", "RETRY_FAILED");
  }
}
