'use server';

import 'server-only';

import { and, count, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { ActionResult, DocumentData } from '@/lib/cms/types';
import { validateDocumentData } from '@/lib/cms/validation';
import { requireMutationUser, requireRole } from '@/lib/auth/server';
import { assertDatabaseConfigured, db } from '@/lib/db';
import {
  auditLog,
  communityActionTokens,
  communityApplications,
  communitySubscribers,
  documents,
} from '@/lib/db/schema';
import { mailJobs } from '@/lib/db/mail-schema';
import { kickMailWorker } from '@/lib/mail/worker';

import { CommunityMailUnavailableError, prepareManualPostDelivery, publishedSnapshotHash, queuePostSnapshot } from './publication';
import { suppressApplicationMailJobs, suppressPostMailJobs } from './revocation';
import type {
  AdminCommunity,
  AdminCommunityApplication,
  AdminCommunitySubscriber,
  CommunityApplicationStatus,
  ManualPushPreview,
} from './types';
import { applicationStatusSchema, communityIdSchema } from './validation';

const LIST_LIMIT = 100;
const manualPushInputSchema = z
  .object({
    documentId: communityIdSchema,
    expectedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/i, '文章版本已变化，请重新预览。'),
  })
  .strict();

function failure<T = undefined>(error: string, code?: string): ActionResult<T> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

class ManualPushConflictError extends Error {}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function readSnapshot(value: DocumentData | null): DocumentData | null {
  if (!value) return null;
  try {
    return validateDocumentData('post', value, {
      allowDemo: true,
      allowSeedFixtures: process.env.NODE_ENV !== 'production',
    });
  } catch {
    return null;
  }
}

async function readPublishedPost(documentId: string): Promise<{ id: string; snapshot: DocumentData; publishedAt: Date } | null> {
  const [row] = await db
    .select({ id: documents.id, published: documents.published, publishedAt: documents.publishedAt })
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.kind, 'post'),
        isNotNull(documents.published),
        isNotNull(documents.publishedSlug),
        isNotNull(documents.publishedAt),
        isNull(documents.deletedAt),
        ne(documents.status, 'archived'),
      ),
    )
    .limit(1);
  const snapshot = readSnapshot(row?.published ?? null);
  if (!row || !snapshot || !row.publishedAt) return null;
  return { id: row.id, snapshot, publishedAt: row.publishedAt };
}

async function countEligibleSubscribers(documentId: string): Promise<number> {
  const [result] = await db
    .select({ total: count() })
    .from(communitySubscribers)
    .leftJoin(
      mailJobs,
      eq(mailJobs.dedupeKey, sql`concat('post:', ${documentId}::text, ':', ${communitySubscribers.id}::text)`),
    )
    .where(
      and(
        eq(communitySubscribers.status, 'confirmed'),
        isNull(communitySubscribers.unsubscribedAt),
        isNull(mailJobs.id),
      ),
    );
  return Number(result?.total ?? 0);
}

function toSubscriber(row: typeof communitySubscribers.$inferSelect): AdminCommunitySubscriber {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    confirmedAt: iso(row.confirmedAt),
    unsubscribedAt: iso(row.unsubscribedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

function toApplication(row: typeof communityApplications.$inferSelect): AdminCommunityApplication {
  const emailVerified = Boolean(row.emailVerifiedAt);
  return {
    id: row.id,
    status: row.status,
    emailVerified,
    name: emailVerified ? row.name : null,
    email: emailVerified ? row.email : null,
    interests: emailVerified ? row.interests : [],
    introduction: emailVerified ? row.introduction : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Admin/editor read-only view: the newest 100 rows are returned, while counts cover all records. */
export async function getAdminCommunity(): Promise<AdminCommunity> {
  assertDatabaseConfigured();
  await requireRole(['admin', 'editor']);
  const [subscriberTotals, applicationTotals, subscribers, applications] = await Promise.all([
    db
      .select({ total: count(), confirmed: sql<number>`count(*) filter (where ${communitySubscribers.status} = 'confirmed' and ${communitySubscribers.unsubscribedAt} is null)` })
      .from(communitySubscribers),
    db.select({ total: count() }).from(communityApplications),
    db.select().from(communitySubscribers).orderBy(desc(communitySubscribers.createdAt)).limit(LIST_LIMIT),
    db.select().from(communityApplications).orderBy(desc(communityApplications.createdAt)).limit(LIST_LIMIT),
  ]);

  return {
    subscriberCount: Number(subscriberTotals[0]?.total ?? 0),
    confirmedSubscriberCount: Number(subscriberTotals[0]?.confirmed ?? 0),
    subscribers: subscribers.map(toSubscriber),
    applicationCount: Number(applicationTotals[0]?.total ?? 0),
    applications: applications.map(toApplication),
  };
}

export async function changeApplicationStatus(
  id: string,
  status: CommunityApplicationStatus,
): Promise<ActionResult<AdminCommunityApplication>> {
  assertDatabaseConfigured();
  const actor = await requireMutationUser(['admin', 'editor']);
  const validId = communityIdSchema.safeParse(id);
  const validStatus = applicationStatusSchema.safeParse(status);
  if (!validId.success || !validStatus.success) return failure('申请资料无效。', 'VALIDATION');

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(communityApplications)
        .where(eq(communityApplications.id, validId.data))
        .for('update')
        .limit(1);
      if (!current) return failure<AdminCommunityApplication>('找不到这份申请。', 'NOT_FOUND');
      if (!current.emailVerifiedAt) return failure<AdminCommunityApplication>('申请人尚未确认邮箱，暂不能处理。', 'PENDING_CONFIRMATION');
      if (current.status === 'withdrawn') return failure<AdminCommunityApplication>('已撤回的申请不能再修改状态。', 'WITHDRAWN');

      const now = new Date();
      const [saved] = await tx
        .update(communityApplications)
        .set({ status: validStatus.data, updatedAt: now })
        .where(eq(communityApplications.id, current.id))
        .returning();
      if (saved) {
        if (saved.status === 'withdrawn') {
          await suppressApplicationMailJobs(tx, saved.id, 'APPLICATION_WITHDRAWN');
        }
        await tx.insert(auditLog).values({
          actorId: actor.id,
          action: 'community.application.status',
          resourceId: saved.id,
          detail: { status: saved.status },
        });
      }
      return saved ? { ok: true as const, data: toApplication(saved) } : failure<AdminCommunityApplication>('申请状态未更新。', 'NOT_FOUND');
    });
  } catch {
    return failure('更新申请状态失败，请稍后重试。', 'INTERNAL');
  }
}

/** Hard deletion is restricted to administrators because it removes the private application record. */
export async function deleteApplication(id: string): Promise<ActionResult> {
  assertDatabaseConfigured();
  const actor = await requireMutationUser(['admin']);
  const validId = communityIdSchema.safeParse(id);
  if (!validId.success) return failure('申请资料无效。', 'VALIDATION');

  try {
    const deleted = await db.transaction(async (tx) => {
      // Serialize with email confirmation: it may otherwise enqueue a private copy between an
      // outbox purge and row deletion.
      const [existing] = await tx
        .select({ id: communityApplications.id })
        .from(communityApplications)
        .where(eq(communityApplications.id, validId.data))
        .for('update')
        .limit(1);
      if (!existing) return false;
      // The outbox retains recipient and body content, so it is part of an application's private
      // record and must be purged together with a deliberate hard deletion.
      await tx.delete(mailJobs).where(sql`"metadata" ->> 'applicationId' = ${validId.data}`);
      const [application] = await tx
        .delete(communityApplications)
        .where(eq(communityApplications.id, validId.data))
        .returning({ id: communityApplications.id });
      if (!application) return false;
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'community.application.delete',
        resourceId: application.id,
        detail: {},
      });
      return true;
    });
    return deleted ? { ok: true, data: undefined } : failure('找不到这份申请。', 'NOT_FOUND');
  } catch {
    return failure('删除申请资料失败，请稍后重试。', 'INTERNAL');
  }
}

/** Keep an unsubscribe/suppression record instead of deleting it, so queued mail is safely stopped. */
export async function removeSubscriber(id: string): Promise<ActionResult> {
  assertDatabaseConfigured();
  const actor = await requireMutationUser(['admin']);
  const validId = communityIdSchema.safeParse(id);
  if (!validId.success) return failure('订阅记录无效。', 'VALIDATION');

  try {
    const removed = await db.transaction(async (tx) => {
      const now = new Date();
      const [subscriber] = await tx
        .update(communitySubscribers)
        .set({ status: 'unsubscribed', unsubscribedAt: now, updatedAt: now })
        .where(eq(communitySubscribers.id, validId.data))
        .returning({ id: communitySubscribers.id });
      if (!subscriber) return false;
      await suppressPostMailJobs(tx, { subscriberId: subscriber.id, reason: 'RECIPIENT_UNSUBSCRIBED' });
      await tx
        .update(communityActionTokens)
        .set({ usedAt: now })
        .where(and(eq(communityActionTokens.subscriberId, subscriber.id), isNull(communityActionTokens.usedAt)));
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'community.subscriber.remove',
        resourceId: subscriber.id,
        detail: {},
      });
      return true;
    });
    return removed ? { ok: true, data: undefined } : failure('找不到这条订阅记录。', 'NOT_FOUND');
  } catch {
    return failure('移除订阅者失败，请稍后重试。', 'INTERNAL');
  }
}

/** Resolve an immutable current public snapshot and its exact eligible-recipient count for the UI. */
export async function previewManualPush(documentId: string): Promise<ActionResult<ManualPushPreview>> {
  assertDatabaseConfigured();
  await requireRole(['admin', 'editor']);
  const validId = communityIdSchema.safeParse(documentId);
  if (!validId.success) return failure('文章标识无效。', 'VALIDATION');

  try {
    await prepareManualPostDelivery();
    const post = await readPublishedPost(validId.data);
    if (!post) return failure('只能推送当前公开的文章。', 'NOT_FOUND');
    return {
      ok: true,
      data: {
        documentId: post.id,
        title: post.snapshot.title,
        excerpt: post.snapshot.excerpt,
        slug: post.snapshot.slug,
        publishedAt: post.publishedAt.toISOString(),
        snapshotHash: publishedSnapshotHash(post.snapshot),
        recipientCount: await countEligibleSubscribers(post.id),
      },
    };
  } catch (error) {
    if (error instanceof CommunityMailUnavailableError) return failure('手动推送尚未启用。', 'UNAVAILABLE');
    return failure('无法准备推送，请稍后重试。', 'INTERNAL');
  }
}

/** Queue a manual article push after the client confirms the exact snapshot it previewed. */
export async function sendManualPush(input: {
  documentId: string;
  expectedSnapshotHash: string;
}): Promise<ActionResult<{ queued: number }>> {
  assertDatabaseConfigured();
  const actor = await requireMutationUser(['admin', 'editor']);
  const parsed = manualPushInputSchema.safeParse(input);
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? '推送信息无效。', 'VALIDATION');

  try {
    const delivery = await prepareManualPostDelivery();
    const initial = await readPublishedPost(parsed.data.documentId);
    if (!initial) return failure('只能推送当前公开的文章。', 'NOT_FOUND');
    if (publishedSnapshotHash(initial.snapshot) !== parsed.data.expectedSnapshotHash) {
      return failure('文章版本已变化，请重新预览。', 'CONFLICT');
    }

    const queued = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: documents.id, published: documents.published, publishedAt: documents.publishedAt })
        .from(documents)
        .where(
          and(
            eq(documents.id, parsed.data.documentId),
            eq(documents.kind, 'post'),
            isNotNull(documents.published),
            isNotNull(documents.publishedSlug),
            isNotNull(documents.publishedAt),
            isNull(documents.deletedAt),
            ne(documents.status, 'archived'),
          ),
      )
        .for('update')
        .limit(1);
      const snapshot = readSnapshot(row?.published ?? null);
      if (!row || !snapshot || !row.publishedAt) throw new ManualPushConflictError();
      if (publishedSnapshotHash(snapshot) !== parsed.data.expectedSnapshotHash) throw new ManualPushConflictError();

      const count = await queuePostSnapshot(tx, {
        documentId: row.id,
        snapshot,
        publicUrl: delivery.publicUrl,
        now: new Date(),
        mode: 'manual',
      });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'community.post.manual_push',
        resourceId: row.id,
        detail: { queued: count, snapshotHash: parsed.data.expectedSnapshotHash },
      });
      return count;
    });
    if (queued > 0) kickMailWorker();
    return { ok: true, data: { queued } };
  } catch (error) {
    if (error instanceof CommunityMailUnavailableError) return failure('手动推送尚未启用。', 'UNAVAILABLE');
    if (error instanceof ManualPushConflictError) return failure('文章版本已变化，请重新预览后再试。', 'CONFLICT');
    return failure('无法将文章推送加入发送队列，请稍后重试。', 'INTERNAL');
  }
}
