import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import type { DocumentData } from '@/lib/cms/types';
import { db } from '@/lib/db';
import {
  communityPublications,
  communitySubscribers,
} from '@/lib/db/community-schema';
import { mailJobs, mailSettings } from '@/lib/db/mail-schema';
import { getMailDeliveryAvailability } from '@/lib/mail/config';
import { enqueueMail } from '@/lib/mail/queue';
import { getEffectivePublicUrl } from '@/lib/site-access/store';

import { postMessage } from './messages';
import { COMMUNITY_TOKEN_TTL, issueCommunityToken } from './tokens';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class CommunityMailUnavailableError extends Error {
  readonly code = 'MAIL_UNAVAILABLE';

  constructor() {
    super('Mail delivery is unavailable.');
  }
}

export type PostDeliveryContext = { publicUrl: string };

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

/** A hash of an immutable public snapshot, suitable for a manual-send drift check. */
export function publishedSnapshotHash(snapshot: DocumentData): string {
  return createHash('sha256').update(stableJson(snapshot), 'utf8').digest('hex');
}

function pathWithToken(publicUrl: string, path: string, token: string): string {
  const url = new URL(path, publicUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

/** Read configuration before the CMS transaction; disabled automatic delivery never blocks publishing. */
export async function prepareAutomaticPostDelivery(): Promise<PostDeliveryContext | null> {
  const availability = await getMailDeliveryAvailability();
  if (!availability.enabled || !availability.notifyOnPublish) return null;
  return { publicUrl: await getEffectivePublicUrl() };
}

/** Manual delivery uses the same mail setting but has its own explicit configuration switch. */
export async function prepareManualPostDelivery(): Promise<PostDeliveryContext> {
  const availability = await getMailDeliveryAvailability();
  if (!availability.enabled || !availability.allowManualPush) throw new CommunityMailUnavailableError();
  return { publicUrl: await getEffectivePublicUrl() };
}

/**
 * Queue one immutable article snapshot per confirmed subscriber. The deterministic key is shared
 * by automatic and manual sends, so either workflow can safely retry without duplicate delivery.
 */
export async function queuePostSnapshot(
  tx: Transaction,
  input: {
    documentId: string;
    snapshot: DocumentData;
    publicUrl: string;
    now?: Date;
    mode?: 'automatic' | 'manual';
    unavailable?: 'skip' | 'throw';
  },
): Promise<number> {
  const now = input.now ?? new Date();
  const mode = input.mode ?? 'manual';
  const unavailable = input.unavailable ?? 'throw';
  const [settings] = await tx
    .select({ enabled: mailSettings.enabled, notifyOnPublish: mailSettings.notifyOnPublish, allowManualPush: mailSettings.allowManualPush })
    .from(mailSettings)
    .where(eq(mailSettings.id, 'default'))
    .limit(1);
  const enabledForMode = Boolean(
    settings?.enabled && (mode === 'automatic' ? settings.notifyOnPublish : settings.allowManualPush),
  );
  if (!enabledForMode) {
    if (unavailable === 'skip') return 0;
    throw new CommunityMailUnavailableError();
  }
  const subscribers = await tx
    .select({ id: communitySubscribers.id, email: communitySubscribers.email })
    .from(communitySubscribers)
    .where(and(eq(communitySubscribers.status, 'confirmed'), isNull(communitySubscribers.unsubscribedAt)));

  let queued = 0;
  const articleUrl = new URL(`/posts/${encodeURIComponent(input.snapshot.slug)}`, input.publicUrl).toString();
  for (const subscriber of subscribers) {
    const dedupeKey = `post:${input.documentId}:${subscriber.id}`;
    const [existing] = await tx
      .select({ id: mailJobs.id })
      .from(mailJobs)
      .where(eq(mailJobs.dedupeKey, dedupeKey))
      .limit(1);
    if (existing) continue;
    const { token } = await issueCommunityToken(tx, {
      purpose: 'unsubscribe',
      subscriberId: subscriber.id,
      ttlMs: COMMUNITY_TOKEN_TTL.unsubscribe,
      now,
    });
    const message = postMessage(
      input.snapshot,
      articleUrl,
      pathWithToken(input.publicUrl, '/subscribe/unsubscribe', token),
    );
    const result = await enqueueMail(tx, {
      dedupeKey,
      to: subscriber.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      kind: 'post',
      metadata: { subscriberId: subscriber.id, documentId: input.documentId },
    });
    if (!result) {
      if (unavailable === 'skip') return queued;
      throw new CommunityMailUnavailableError();
    }
    if (result.created) queued += 1;
  }
  return queued;
}

/**
 * Insert the first-publication marker and outbox records in the same transaction as publishing.
 * The marker is never changed by unpublish, so a republish cannot produce another automatic send.
 */
export async function recordInitialPublishedPost(
  tx: Transaction,
  input: { documentId: string; snapshot: DocumentData; publishedAt: Date; delivery: PostDeliveryContext | null },
): Promise<number> {
  const [publication] = await tx
    .insert(communityPublications)
    .values({
      documentId: input.documentId,
      snapshot: input.snapshot,
      snapshotHash: publishedSnapshotHash(input.snapshot),
      initialPublishedAt: input.publishedAt,
    })
    .onConflictDoNothing({ target: communityPublications.documentId })
    .returning({ id: communityPublications.id });

  if (!publication || !input.delivery) return 0;
  const queued = await queuePostSnapshot(tx, {
    documentId: input.documentId,
    snapshot: input.snapshot,
    publicUrl: input.delivery.publicUrl,
    now: input.publishedAt,
    mode: 'automatic',
    unavailable: 'skip',
  });
  await tx
    .update(communityPublications)
    .set({ automaticNoticeQueuedAt: input.publishedAt })
    .where(eq(communityPublications.id, publication.id));
  return queued;
}
