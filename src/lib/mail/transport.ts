import "server-only";

import nodemailer from "nodemailer";

import type { MailDeliveryConfig } from "./config";

export type MailMessage = {
  from: { name: string; address: string } | string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  messageId: string;
  disableFileAccess: true;
  disableUrlAccess: true;
};

export type MailTransport = {
  sendMail(message: MailMessage): Promise<unknown>;
  close?: () => void | Promise<void>;
};

/** Construct a TLS-only SMTP transport. The caller owns and closes this short-lived transport. */
export function createSmtpTransport(config: MailDeliveryConfig): MailTransport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // Direct TLS (normally 465) has no plaintext phase. STARTTLS is explicitly required below.
    secure: config.security === "tls",
    requireTLS: true,
    ignoreTLS: false,
    opportunisticTLS: false,
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
}
