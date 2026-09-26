import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const CIPHER_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const KEY_SALT = Buffer.from("darwin-journal:mail-settings:salt:v1", "utf8");
const KEY_INFO = Buffer.from(
  "darwin-journal:smtp-password:aes-256-gcm:v1",
  "utf8",
);
const ADDITIONAL_DATA = Buffer.from("darwin-journal:smtp-password:v1", "utf8");

export class MailEncryptionError extends Error {
  constructor() {
    super("Mail credentials could not be decrypted.");
    this.name = "MailEncryptionError";
  }
}

function configuredAuthSecret(): string | undefined {
  return (
    process.env.BETTER_AUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim()
  );
}

/**
 * Derive a purpose-bound encryption key instead of using the Better Auth secret directly.
 * The stable deployment secret is intentionally the source of truth for this key.
 */
export function deriveMailEncryptionKey(
  secret = configuredAuthSecret(),
): Buffer {
  if (!secret || secret.length < 32) {
    throw new MailEncryptionError();
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      KEY_SALT,
      KEY_INFO,
      KEY_BYTES,
    ),
  );
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    throw new MailEncryptionError();
  }
}

/** Encrypt an SMTP password with AES-256-GCM and authenticated context. */
export function encryptSmtpPassword(
  password: string,
  secret = configuredAuthSecret(),
): string {
  if (!password) throw new MailEncryptionError();

  const key = deriveMailEncryptionKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(ADDITIONAL_DATA);
  const ciphertext = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [CIPHER_VERSION, encode(iv), encode(tag), encode(ciphertext)].join(
    ".",
  );
}

function decryptWithSecret(
  ciphertext: string,
  secret: string | undefined,
): string {
  const [version, encodedIv, encodedTag, encodedPayload, ...rest] =
    ciphertext.split(".");
  if (
    version !== CIPHER_VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedPayload ||
    rest.length > 0
  ) {
    throw new MailEncryptionError();
  }

  const iv = decode(encodedIv);
  const tag = decode(encodedTag);
  const payload = decode(encodedPayload);
  if (
    iv.length !== IV_BYTES ||
    tag.length !== TAG_BYTES ||
    payload.length === 0
  ) {
    throw new MailEncryptionError();
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveMailEncryptionKey(secret),
      iv,
      {
        authTagLength: TAG_BYTES,
      },
    );
    decipher.setAAD(ADDITIONAL_DATA);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    // Do not include implementation errors: they can disclose values passed to crypto APIs.
    throw new MailEncryptionError();
  }
}

/**
 * `MAIL_ENCRYPTION_PREVIOUS_SECRET` is a temporary rotation bridge. A subsequent admin save
 * re-encrypts the retained password using the current BETTER_AUTH_SECRET.
 */
export function decryptSmtpPassword(ciphertext: string): string {
  try {
    return decryptWithSecret(ciphertext, configuredAuthSecret());
  } catch {
    const previousSecret = process.env.MAIL_ENCRYPTION_PREVIOUS_SECRET?.trim();
    if (!previousSecret) throw new MailEncryptionError();
    return decryptWithSecret(ciphertext, previousSecret);
  }
}
