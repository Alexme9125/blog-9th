'use server';

import 'server-only';

import { and, eq, isNull, ne } from 'drizzle-orm';

import { assertDatabaseConfigured, db } from '@/lib/db';
import {
  communityActionTokens,
  communityApplications,
  communitySubscribers,
} from '@/lib/db/community-schema';
import { getMailDeliveryAvailability } from '@/lib/mail/config';
import { enqueueMail } from '@/lib/mail/queue';
import { kickMailWorker } from '@/lib/mail/worker';
import { getEffectivePublicUrl } from '@/lib/site-access/store';

import {
  applicationCopyMessage,
  applicationNotificationMessage,
  applicationVerificationMessage,
  subscriptionConfirmationMessage,
} from './messages';
import { CommunityMailUnavailableError } from './publication';
import { CommunityRateLimitError, consumePublicCommunityRateLimit } from './rate-limit';
import { CommunityOriginError, requireTrustedCommunityRequest } from './request';
import { suppressPostMailJobs } from './revocation';
import { COMMUNITY_TOKEN_TTL, consumeCommunityToken, hashCommunityToken, issueCommunityToken } from './tokens';
import type { PublicCommunityActionResult } from './types';
import { actionTokenSchema, applicationInputSchema, subscribeInputSchema, type ApplicationInput, type SubscribeInput } from './validation';

const confirmationSentMessage = '如果这个邮箱尚未完成确认，我们已发送下一步操作链接。请检查收件箱和垃圾邮件文件夹。';

function success(message: string): PublicCommunityActionResult {
  return { ok: true, message };
}

function failure(error: string, code?: string): PublicCommunityActionResult {
  return { ok: false, error, ...(code ? { code } : {}) };
}

function tokenUrl(publicUrl: string, path: string, token: string): string {
  const url = new URL(path, publicUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

function genericPublicError(error: unknown, fallback = '暂时无法完成请求，请稍后重试。'): PublicCommunityActionResult {
  if (error instanceof CommunityOriginError) return failure('请求来源无效，请从本站页面重新提交。', error.code);
  if (error instanceof CommunityRateLimitError) return failure('操作过于频繁，请稍后再试。', error.code);
  if (error instanceof CommunityMailUnavailableError) return failure('邮件服务暂时不可用，请稍后再试。', error.code);
  return failure(fallback, 'INTERNAL');
}

async function consumeTokenAttemptBudget(ip: string | null): Promise<void> {
  await db.transaction((tx) => consumePublicCommunityRateLimit(tx, 'token', { ...(ip ? { ip } : {}) }));
}

/** The public page uses this to hide forms until its mail destination is configured. */
export async function getPublicCommunityAvailability(): Promise<{ subscriptions: boolean; applications: boolean }> {
  try {
    const availability = await getMailDeliveryAvailability();
    return {
      subscriptions: availability.enabled,
      applications: availability.enabled && Boolean(availability.applicationRecipient),
    };
  } catch {
    return { subscriptions: false, applications: false };
  }
}

/** Start or re-start a double-opt-in subscription without revealing whether an address exists. */
export async function subscribe(input: SubscribeInput): Promise<PublicCommunityActionResult> {
  const parsed = subscribeInputSchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? '请检查订阅信息。', 'VALIDATION');

  try {
    assertDatabaseConfigured();
    const context = await requireTrustedCommunityRequest();
    const value = parsed.data;
    const availability = await getMailDeliveryAvailability();
    if (!availability.enabled) return failure('邮件订阅暂未开放。', 'UNAVAILABLE');

    // Honeypot requests receive the same generic acknowledgement, while their global/IP budget
    // is still consumed so automated probes cannot avoid the shared limit.
    if (value.website?.trim()) {
      await db.transaction((tx) => consumePublicCommunityRateLimit(tx, 'subscribe', { email: value.email, ...(context.ip ? { ip: context.ip } : {}) }));
      return success(confirmationSentMessage);
    }

    const publicUrl = await getEffectivePublicUrl();
    await db.transaction(async (tx) => {
      const now = new Date();
      await consumePublicCommunityRateLimit(tx, 'subscribe', { email: value.email, ...(context.ip ? { ip: context.ip } : {}) }, now);

      // Existing confirmed records intentionally produce no distinguishing action or response.
      const [subscriber] = await tx
        .insert(communitySubscribers)
        .values({ email: value.email, status: 'pending', consentAt: now })
        .onConflictDoUpdate({
          target: communitySubscribers.email,
          set: { status: 'pending', consentAt: now, confirmedAt: null, unsubscribedAt: null, updatedAt: now },
          setWhere: ne(communitySubscribers.status, 'confirmed'),
        })
        .returning({ id: communitySubscribers.id });

      if (!subscriber) return;

      // Resubscription deliberately invalidates older confirmation and unsubscribe links.
      await tx
        .update(communityActionTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(communityActionTokens.subscriberId, subscriber.id),
            isNull(communityActionTokens.usedAt),
          ),
        );

      const { token } = await issueCommunityToken(tx, {
        purpose: 'subscription_confirmation',
        subscriberId: subscriber.id,
        ttlMs: COMMUNITY_TOKEN_TTL.confirmation,
        now,
      });
      const message = subscriptionConfirmationMessage(tokenUrl(publicUrl, '/subscribe/confirm', token));
      const queued = await enqueueMail(tx, {
        dedupeKey: `subscription-confirm:${subscriber.id}:${hashCommunityToken(token)}`,
        to: value.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        kind: 'subscription-confirm',
        metadata: { subscriberId: subscriber.id },
      });
      if (!queued) throw new CommunityMailUnavailableError();
    });
    kickMailWorker();
    return success(confirmationSentMessage);
  } catch (error) {
    return genericPublicError(error);
  }
}

/** Consume a confirmation token once and activate the corresponding subscription. */
export async function confirmSubscription(token: string): Promise<PublicCommunityActionResult> {
  try {
    assertDatabaseConfigured();
    const context = await requireTrustedCommunityRequest();
    // Count token guesses in a separate completed transaction, including invalid/expired links.
    await consumeTokenAttemptBudget(context.ip);
    if (!actionTokenSchema.safeParse(token).success) return failure('确认链接无效或已过期。', 'INVALID_TOKEN');

    const activated = await db.transaction(async (tx) => {
      const now = new Date();
      const used = await consumeCommunityToken(tx, token, 'subscription_confirmation', now);
      if (!used?.subscriberId) return false;
      const [subscriber] = await tx
        .update(communitySubscribers)
        .set({ status: 'confirmed', confirmedAt: now, unsubscribedAt: null, updatedAt: now })
        .where(and(eq(communitySubscribers.id, used.subscriberId), ne(communitySubscribers.status, 'unsubscribed')))
        .returning({ id: communitySubscribers.id });
      return Boolean(subscriber);
    });
    return activated ? success('订阅已确认。之后有新文章时，我们会将摘要和链接发送到你的邮箱。') : failure('确认链接无效或已过期。', 'INVALID_TOKEN');
  } catch (error) {
    return genericPublicError(error);
  }
}

/** This Server Action is POST-only; its GET page merely shows the explicit confirmation button. */
export async function unsubscribe(token: string): Promise<PublicCommunityActionResult> {
  try {
    assertDatabaseConfigured();
    const context = await requireTrustedCommunityRequest();
    await consumeTokenAttemptBudget(context.ip);
    if (!actionTokenSchema.safeParse(token).success) return failure('退订链接无效。', 'INVALID_TOKEN');

    const removed = await db.transaction(async (tx) => {
      const now = new Date();
      const used = await consumeCommunityToken(tx, token, 'unsubscribe', now);
      if (!used?.subscriberId) return false;
      const [subscriber] = await tx
        .update(communitySubscribers)
        .set({ status: 'unsubscribed', unsubscribedAt: now, updatedAt: now })
        .where(eq(communitySubscribers.id, used.subscriberId))
        .returning({ id: communitySubscribers.id });
      if (!subscriber) return false;
      await suppressPostMailJobs(tx, { subscriberId: subscriber.id, reason: 'RECIPIENT_UNSUBSCRIBED' });
      await tx
        .update(communityActionTokens)
        .set({ usedAt: now })
        .where(and(eq(communityActionTokens.subscriberId, subscriber.id), isNull(communityActionTokens.usedAt)));
      return true;
    });
    return removed ? success('你已退订，不会再收到社团的文章推送。') : failure('退订链接无效。', 'INVALID_TOKEN');
  } catch (error) {
    return genericPublicError(error);
  }
}

/** Stage an application privately, then prove email ownership before sending its contents anywhere. */
export async function submitApplication(input: ApplicationInput): Promise<PublicCommunityActionResult> {
  const parsed = applicationInputSchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? '请检查申请信息。', 'VALIDATION');

  try {
    assertDatabaseConfigured();
    const context = await requireTrustedCommunityRequest();
    const value = parsed.data;
    const availability = await getMailDeliveryAvailability();
    if (!availability.enabled || !availability.applicationRecipient) return failure('入社申请暂未开放。', 'UNAVAILABLE');

    if (value.website?.trim()) {
      await db.transaction((tx) => consumePublicCommunityRateLimit(tx, 'application', { email: value.email, ...(context.ip ? { ip: context.ip } : {}) }));
      return success(confirmationSentMessage);
    }

    const publicUrl = await getEffectivePublicUrl();
    await db.transaction(async (tx) => {
      const now = new Date();
      await consumePublicCommunityRateLimit(tx, 'application', { email: value.email, ...(context.ip ? { ip: context.ip } : {}) }, now);
      const [application] = await tx
        .insert(communityApplications)
        .values({
          name: value.name,
          email: value.email,
          interests: value.interests,
          introduction: value.introduction,
          consentAt: now,
        })
        .returning({ id: communityApplications.id });
      if (!application) throw new Error('Could not save application.');

      const { token } = await issueCommunityToken(tx, {
        purpose: 'application_receipt',
        applicationId: application.id,
        ttlMs: COMMUNITY_TOKEN_TTL.applicationReceipt,
        now,
      });
      const message = applicationVerificationMessage(tokenUrl(publicUrl, '/join/confirm', token));
      const queued = await enqueueMail(tx, {
        dedupeKey: `application-verification:${application.id}`,
        to: value.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
        kind: 'application-copy',
        metadata: { applicationId: application.id, applicationEmailPurpose: 'verification' },
      });
      if (!queued) throw new CommunityMailUnavailableError();
    });
    kickMailWorker();
    return success(confirmationSentMessage);
  } catch (error) {
    return genericPublicError(error);
  }
}

/**
 * The confirmation link proves the applicant controls this address. Only then do we enqueue a
 * full copy for the applicant and the private review notification for the configured recipient.
 */
export async function confirmApplicationReceipt(token: string): Promise<PublicCommunityActionResult> {
  try {
    assertDatabaseConfigured();
    const context = await requireTrustedCommunityRequest();
    await consumeTokenAttemptBudget(context.ip);
    if (!actionTokenSchema.safeParse(token).success) return failure('确认链接无效或已过期。', 'INVALID_TOKEN');

    const availability = await getMailDeliveryAvailability();
    if (!availability.enabled || !availability.applicationRecipient) {
      return failure('邮件服务暂时不可用，请稍后再试。', 'UNAVAILABLE');
    }

    const confirmed = await db.transaction(async (tx) => {
      const now = new Date();
      const used = await consumeCommunityToken(tx, token, 'application_receipt', now);
      if (!used?.applicationId) return false;
      const [application] = await tx
        .update(communityApplications)
        .set({ emailVerifiedAt: now, updatedAt: now })
        .where(and(eq(communityApplications.id, used.applicationId), isNull(communityApplications.emailVerifiedAt), ne(communityApplications.status, 'withdrawn')))
        .returning({
          id: communityApplications.id,
          name: communityApplications.name,
          email: communityApplications.email,
          interests: communityApplications.interests,
          introduction: communityApplications.introduction,
        });
      if (!application) return false;

      const copy = applicationCopyMessage(application);
      const notification = applicationNotificationMessage(application);
      const queuedCopy = await enqueueMail(tx, {
        dedupeKey: `application-copy:${application.id}`,
        to: application.email,
        subject: copy.subject,
        text: copy.text,
        html: copy.html,
        kind: 'application-copy',
        metadata: { applicationId: application.id },
      });
      const queuedNotification = await enqueueMail(tx, {
        dedupeKey: `application-notification:${application.id}`,
        to: availability.applicationRecipient,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
        kind: 'application-notification',
        metadata: { applicationId: application.id },
      });
      if (!queuedCopy || !queuedNotification) throw new CommunityMailUnavailableError();
      return true;
    });
    if (confirmed) kickMailWorker();
    return confirmed
      ? success('邮箱已确认，申请已提交给社团。申请副本会发送到你的邮箱。')
      : failure('确认链接无效或已过期。', 'INVALID_TOKEN');
  } catch (error) {
    return genericPublicError(error);
  }
}
