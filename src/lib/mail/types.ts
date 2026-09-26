/**
 * Client-safe contracts for the mail settings screen and community workflows.
 * Server-only implementation details, including encrypted SMTP credentials,
 * intentionally live outside this module.
 */

export type MailSecurity = "tls" | "starttls";

export type MailKind =
  | "subscription-confirm"
  | "post"
  | "application-copy"
  | "application-notification"
  | "test";

export type MailJobStatus =
  "queued" | "processing" | "sent" | "failed" | "suppressed";

/** IDs let the worker re-check delivery eligibility immediately before sending. */
export type MailMetadata = {
  subscriberId?: string;
  documentId?: string;
  applicationId?: string;
  /** Only an ownership-verification email may be delivered before application verification. */
  applicationEmailPurpose?: "verification";
  [key: string]: unknown;
};

export type EnqueueMailInput = {
  /** A deterministic, per-recipient idempotency key. */
  dedupeKey: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  kind: MailKind;
  metadata?: MailMetadata;
};

/** The redacted settings shape returned to administrators. It never includes a password. */
export type MailSettings = {
  enabled: boolean;
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  hasPassword: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  applicationRecipient: string;
  notifyOnPublish: boolean;
  allowManualPush: boolean;
};

/**
 * Blank or omitted `password` preserves the current credential. Set
 * `clearPassword` explicitly to remove it.
 */
export type MailSettingsInput = {
  enabled: boolean;
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  password?: string;
  clearPassword?: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  applicationRecipient: string;
  notifyOnPublish: boolean;
  allowManualPush: boolean;
};

/** Values safe to return to the admin delivery-history UI. `to` is masked. */
export type AdminMailJob = {
  id: string;
  to: string;
  subject: string;
  kind: MailKind;
  status: MailJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type MailDeliveryAvailability = {
  enabled: boolean;
  notifyOnPublish: boolean;
  allowManualPush: boolean;
  applicationRecipient: string;
};
