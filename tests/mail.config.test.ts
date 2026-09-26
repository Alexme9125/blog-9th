import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toMailSettings, validateMailSettingsInput } from "@/lib/mail/config";
import {
  decryptSmtpPassword,
  encryptSmtpPassword,
  MailEncryptionError,
} from "@/lib/mail/crypto";
import type { MailSettingsRow } from "@/lib/db/mail-schema";

const originalSecret = process.env.BETTER_AUTH_SECRET;
const originalPreviousSecret = process.env.MAIL_ENCRYPTION_PREVIOUS_SECRET;
const encryptionSecret =
  "mail-config-test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    host: "smtp.example.test",
    port: 587,
    security: "starttls",
    username: "mailer@example.test",
    fromName: "Darwin Journal",
    fromEmail: "mailer@example.test",
    replyTo: "reply@example.test",
    applicationRecipient: "applications@example.test",
    notifyOnPublish: false,
    allowManualPush: true,
    ...overrides,
  };
}

function storedSettings(): MailSettingsRow {
  const now = new Date("2026-09-26T00:00:00.000Z");
  return {
    id: "default",
    enabled: true,
    host: "smtp.example.test",
    port: 587,
    security: "starttls",
    username: "mailer@example.test",
    passwordEncrypted: encryptSmtpPassword(
      "unreturned-smtp-password",
      encryptionSecret,
    ),
    fromName: "Darwin Journal",
    fromEmail: "mailer@example.test",
    replyTo: "reply@example.test",
    applicationRecipient: "applications@example.test",
    notifyOnPublish: false,
    allowManualPush: true,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = encryptionSecret;
  delete process.env.MAIL_ENCRYPTION_PREVIOUS_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = originalSecret;
  if (originalPreviousSecret === undefined)
    delete process.env.MAIL_ENCRYPTION_PREVIOUS_SECRET;
  else process.env.MAIL_ENCRYPTION_PREVIOUS_SECRET = originalPreviousSecret;
});

describe("mail configuration security", () => {
  it("encrypts SMTP passwords with authenticated AES-GCM without serializing plaintext", () => {
    const password = "smtp-password-never-in-database-or-action-result";
    const ciphertext = encryptSmtpPassword(password);

    expect(ciphertext).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    expect(ciphertext).not.toContain(password);
    expect(decryptSmtpPassword(ciphertext)).toBe(password);
  });

  it("fails closed on a wrong key without including the SMTP password in an error", () => {
    const password = "smtp-password-must-not-leak";
    const ciphertext = encryptSmtpPassword(password, encryptionSecret);
    process.env.BETTER_AUTH_SECRET =
      "different-mail-config-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

    let error: unknown;
    try {
      decryptSmtpPassword(ciphertext);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(MailEncryptionError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(password);
  });

  it("rejects header-injection attempts in SMTP settings and normalizes valid addresses", () => {
    expect(() =>
      validateMailSettingsInput(
        validInput({ fromName: "Sender\r\nBcc: victim@example.test" }),
      ),
    ).toThrow("发件人名称");
    expect(() =>
      validateMailSettingsInput(
        validInput({
          replyTo: "reply@example.test\r\nBcc: victim@example.test",
        }),
      ),
    ).toThrow();
    expect(
      validateMailSettingsInput(
        validInput({ fromEmail: "MAILER@EXAMPLE.TEST " }),
      ),
    ).toMatchObject({
      fromEmail: "mailer@example.test",
      notifyOnPublish: false,
      allowManualPush: true,
    });
  });

  it("returns a redacted settings DTO with safe defaults and no credential field", () => {
    expect(toMailSettings(null)).toMatchObject({
      enabled: false,
      notifyOnPublish: false,
      allowManualPush: true,
    });

    const settings = toMailSettings(storedSettings());
    expect(settings).toMatchObject({ enabled: true, hasPassword: true });
    expect(settings).not.toHaveProperty("password");
    expect(settings).not.toHaveProperty("passwordEncrypted");
    expect(JSON.stringify(settings)).not.toContain("unreturned-smtp-password");
  });
});
