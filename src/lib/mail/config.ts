import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptSmtpPassword,
  encryptSmtpPassword,
  MailEncryptionError,
} from "./crypto";
import type {
  MailDeliveryAvailability,
  MailSecurity,
  MailSettings,
  MailSettingsInput,
} from "./types";
import { assertDatabaseConfigured, db } from "@/lib/db";
import { mailSettings, type MailSettingsRow } from "@/lib/db/mail-schema";

export const MAIL_SETTINGS_ID = "default";

const mailSecuritySchema = z.enum(["tls", "starttls"]);
const hostnameSchema = z
  .string()
  .trim()
  .min(1, "请输入 SMTP 主机。")
  .max(253, "SMTP 主机过长。")
  .refine(
    (value) => !/[\s/@:]/.test(value),
    "SMTP 主机只能填写主机名或 IP 地址，不能包含协议或端口。",
  );
const addressSchema = z
  .string()
  .trim()
  .max(320, "邮箱地址过长。")
  .email("请输入有效的邮箱地址。");
const shortTextSchema = z
  .string()
  .trim()
  .max(160, "内容过长。")
  .refine((value) => !/[\r\n]/.test(value), "不能包含换行符。");

const rawSettingsSchema = z
  .object({
    enabled: z.boolean(),
    host: z.string().max(253, "SMTP 主机过长。"),
    port: z
      .number()
      .int("SMTP 端口必须是整数。")
      .min(1, "SMTP 端口必须介于 1 到 65535。")
      .max(65535, "SMTP 端口必须介于 1 到 65535。"),
    security: mailSecuritySchema,
    username: z
      .string()
      .max(320, "用户名过长。")
      .refine((value) => !/[\r\n]/.test(value), "用户名不能包含换行符。"),
    password: z.string().max(1024, "SMTP 密码过长。").optional(),
    clearPassword: z.boolean().optional(),
    fromName: z.string().max(160, "发件人名称过长。"),
    fromEmail: z.string().max(320, "发件人邮箱过长。"),
    replyTo: z.string().max(320, "回复邮箱过长。"),
    applicationRecipient: z.string().max(320, "申请通知邮箱过长。"),
    notifyOnPublish: z.boolean(),
    allowManualPush: z.boolean(),
  })
  .strict();

export class MailValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailValidationError";
  }
}

export class MailConfigurationError extends Error {
  constructor() {
    super("Mail delivery is not configured.");
    this.name = "MailConfigurationError";
  }
}

function validationMessage(result: z.ZodSafeParseResult<unknown>): string {
  return result.success
    ? "邮件设置无效。"
    : (result.error.issues[0]?.message ?? "邮件设置无效。");
}

function optionalAddress(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = addressSchema.safeParse(trimmed);
  if (!parsed.success)
    throw new MailValidationError(`${label}${validationMessage(parsed)}`);
  return parsed.data.toLowerCase();
}

function requiredAddress(value: string, label: string): string {
  const normalized = optionalAddress(value, label);
  if (!normalized) throw new MailValidationError(`请输入${label}。`);
  return normalized;
}

function toFinitePort(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.NaN;
}

/** Validate untrusted Server Action input without ever inspecting stored credentials. */
export function validateMailSettingsInput(input: unknown): MailSettingsInput {
  const parsed = rawSettingsSchema.safeParse({
    ...(typeof input === "object" && input !== null ? input : {}),
    port: toFinitePort(
      typeof input === "object" && input !== null && "port" in input
        ? input.port
        : undefined,
    ),
  });
  if (!parsed.success) throw new MailValidationError(validationMessage(parsed));

  const value = parsed.data;
  if (value.clearPassword && value.password && value.password.trim()) {
    throw new MailValidationError("清除 SMTP 密码时不能同时填写新密码。");
  }

  const fromName = shortTextSchema.safeParse(value.fromName);
  if (!fromName.success)
    throw new MailValidationError(`发件人名称${validationMessage(fromName)}`);

  const normalized: MailSettingsInput = {
    enabled: value.enabled,
    host: value.host.trim(),
    port: value.port,
    security: value.security,
    username: value.username.trim(),
    ...(value.password === undefined ? {} : { password: value.password }),
    ...(value.clearPassword ? { clearPassword: true } : {}),
    fromName: fromName.data,
    fromEmail: optionalAddress(value.fromEmail, "发件人邮箱"),
    replyTo: optionalAddress(value.replyTo, "回复邮箱"),
    applicationRecipient: optionalAddress(
      value.applicationRecipient,
      "申请通知邮箱",
    ),
    notifyOnPublish: value.notifyOnPublish,
    allowManualPush: value.allowManualPush,
  };

  if (normalized.enabled) {
    const host = hostnameSchema.safeParse(normalized.host);
    if (!host.success) throw new MailValidationError(validationMessage(host));
    normalized.host = host.data;
    normalized.fromEmail = requiredAddress(normalized.fromEmail, "发件人邮箱");
    if (!normalized.username)
      throw new MailValidationError("启用 SMTP 时必须填写用户名。");
  }

  return normalized;
}

function defaultSettings(): MailSettings {
  return {
    enabled: false,
    host: "",
    port: 587,
    security: "starttls",
    username: "",
    hasPassword: false,
    fromName: "",
    fromEmail: "",
    replyTo: "",
    applicationRecipient: "",
    notifyOnPublish: false,
    allowManualPush: true,
  };
}

export function toMailSettings(
  row: MailSettingsRow | null | undefined,
): MailSettings {
  if (!row) return defaultSettings();
  return {
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    security: row.security,
    username: row.username,
    hasPassword: Boolean(row.passwordEncrypted),
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    replyTo: row.replyTo,
    applicationRecipient: row.applicationRecipient,
    notifyOnPublish: row.notifyOnPublish,
    allowManualPush: row.allowManualPush,
  };
}

export async function readStoredMailSettings(): Promise<MailSettingsRow | null> {
  assertDatabaseConfigured();
  const [row] = await db
    .select()
    .from(mailSettings)
    .where(eq(mailSettings.id, MAIL_SETTINGS_ID))
    .limit(1);
  return row ?? null;
}

export async function getAdminMailSettings(): Promise<MailSettings> {
  return toMailSettings(await readStoredMailSettings());
}

/** Public callers receive only availability, never provider or recipient information. */
export async function getPublicMailAvailability(): Promise<{
  available: boolean;
}> {
  if (!process.env.DATABASE_URL?.trim()) return { available: false };
  const settings = await readStoredMailSettings();
  return { available: Boolean(settings?.enabled) };
}

/** Server-only toggle read used by publish and manual-push workflows. */
export async function getMailDeliveryAvailability(): Promise<MailDeliveryAvailability> {
  if (!process.env.DATABASE_URL?.trim()) {
    return {
      enabled: false,
      notifyOnPublish: false,
      allowManualPush: false,
      applicationRecipient: "",
    };
  }

  const settings = await readStoredMailSettings();
  if (!settings) {
    return {
      enabled: false,
      notifyOnPublish: false,
      allowManualPush: true,
      applicationRecipient: "",
    };
  }

  return {
    enabled: settings.enabled,
    notifyOnPublish: settings.notifyOnPublish,
    allowManualPush: settings.allowManualPush,
    applicationRecipient: settings.applicationRecipient,
  };
}

export type MailDeliveryConfig = {
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
};

/** Read and decrypt credentials only in the SMTP worker's server-only context. */
export async function getMailDeliveryConfig(): Promise<MailDeliveryConfig | null> {
  const stored = await readStoredMailSettings();
  if (!stored?.enabled) return null;
  if (!stored.passwordEncrypted) throw new MailConfigurationError();

  try {
    const input = validateMailSettingsInput({
      enabled: stored.enabled,
      host: stored.host,
      port: stored.port,
      security: stored.security,
      username: stored.username,
      fromName: stored.fromName,
      fromEmail: stored.fromEmail,
      replyTo: stored.replyTo,
      applicationRecipient: stored.applicationRecipient,
      notifyOnPublish: stored.notifyOnPublish,
      allowManualPush: stored.allowManualPush,
    });
    const password = decryptSmtpPassword(stored.passwordEncrypted);
    // An enabled row must never silently pause delivery because its credential is malformed.
    // The worker records a generic retryable configuration error instead.
    if (!password) throw new MailConfigurationError();
    return {
      host: input.host,
      port: input.port,
      security: input.security,
      username: input.username,
      password,
      fromName: input.fromName,
      fromEmail: input.fromEmail,
      replyTo: input.replyTo,
    };
  } catch (error) {
    if (
      error instanceof MailValidationError ||
      error instanceof MailEncryptionError
    ) {
      throw new MailConfigurationError();
    }
    throw error;
  }
}

/**
 * Persist a redacted configuration. Retaining a blank password also re-encrypts it with the
 * current key, which completes a `MAIL_ENCRYPTION_PREVIOUS_SECRET` rotation.
 */
export async function saveStoredMailSettings(
  input: unknown,
): Promise<MailSettings> {
  assertDatabaseConfigured();
  const value = validateMailSettingsInput(input);
  const current = await readStoredMailSettings();
  let passwordEncrypted: string | null = null;

  const suppliedPassword =
    value.password && value.password.trim() ? value.password : undefined;
  if (suppliedPassword) {
    passwordEncrypted = encryptSmtpPassword(suppliedPassword);
  } else if (!value.clearPassword && current?.passwordEncrypted) {
    // This intentionally verifies the old ciphertext before retaining it and moves it to the
    // current key. A malformed/rotated-away credential should fail closed rather than be hidden.
    passwordEncrypted = encryptSmtpPassword(
      decryptSmtpPassword(current.passwordEncrypted),
    );
  }

  if (value.enabled && !passwordEncrypted) {
    throw new MailValidationError("启用 SMTP 时必须填写 SMTP 密码。");
  }

  const [saved] = await db
    .insert(mailSettings)
    .values({
      id: MAIL_SETTINGS_ID,
      enabled: value.enabled,
      host: value.host,
      port: value.port,
      security: value.security,
      username: value.username,
      passwordEncrypted,
      fromName: value.fromName,
      fromEmail: value.fromEmail,
      replyTo: value.replyTo,
      applicationRecipient: value.applicationRecipient,
      notifyOnPublish: value.notifyOnPublish,
      allowManualPush: value.allowManualPush,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: mailSettings.id,
      set: {
        enabled: value.enabled,
        host: value.host,
        port: value.port,
        security: value.security,
        username: value.username,
        passwordEncrypted,
        fromName: value.fromName,
        fromEmail: value.fromEmail,
        replyTo: value.replyTo,
        applicationRecipient: value.applicationRecipient,
        notifyOnPublish: value.notifyOnPublish,
        allowManualPush: value.allowManualPush,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!saved) throw new MailConfigurationError();
  return toMailSettings(saved);
}
