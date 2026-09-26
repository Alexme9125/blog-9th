'use server';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type {
  ActionResult,
  AdminDocument,
  DashboardData,
  DocumentData,
  DocumentRevision,
  SaveDocumentInput,
  TransitionInput,
} from './types';
import {
  assertDatabase,
  canAccessDocument,
  canCreateKind,
  canEditAll,
  revalidatePublicContent,
  safeActionError,
  toAdminDocument,
  versionOf,
} from './internal';
import { ValidationError, isPlainObject, validateDocumentData } from './validation';
import { requireMutationUser, requireUser } from '@/lib/auth/server';
import { prepareAutomaticPostDelivery, recordInitialPublishedPost } from '@/lib/community/publication';
import { suppressPostMailJobs } from '@/lib/community/revocation';
import { db } from '@/lib/db';
import { kickMailWorker } from '@/lib/mail/worker';
import {
  auditLog,
  categories,
  documentCategories,
  documents,
  documentTags,
  revisions,
  tags,
  users,
} from '@/lib/db/schema';

type DocumentFilters = {
  kind?: string;
  status?: string;
  q?: string;
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const documentSelection = {
  id: documents.id,
  kind: documents.kind,
  status: documents.status,
  version: documents.version,
  draft: documents.draft,
  published: documents.published,
  authorId: documents.authorId,
  authorName: users.name,
  publishedAt: documents.publishedAt,
  updatedAt: documents.updatedAt,
  deletedAt: documents.deletedAt,
};

function failure<T = undefined>(error: string, code?: string): ActionResult<T> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

function ensureDocumentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new ValidationError('文档 ID 不正确。');
  }
  return value;
}

function ensureDocumentKind(value: unknown): 'post' | 'page' {
  if (value !== 'post' && value !== 'page') throw new ValidationError('文档类型不正确。');
  return value;
}

function ensureTransitionAction(value: unknown): TransitionInput['action'] {
  if (!['submit', 'publish', 'return', 'unpublish', 'trash', 'restore', 'delete'].includes(String(value))) {
    throw new ValidationError('不支持的文档操作。');
  }
  return value as TransitionInput['action'];
}

function ensureExpectedVersion(value: unknown): number {
  const version = versionOf(value);
  if (version === null) throw new ValidationError('缺少有效的文档版本，请刷新后重试。');
  return version;
}

function ensureNote(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new ValidationError('操作说明必须是文本。');
  const note = value.trim();
  if (note.length > 500) throw new ValidationError('操作说明不能超过 500 个字符。');
  return note;
}

function matchesSearch(document: AdminDocument, query: string): boolean {
  if (!query) return true;
  const haystack = [document.draft.title, document.draft.excerpt, document.draft.slug, JSON.stringify(document.draft.body)]
    .join('\n')
    .toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

async function findDocument(id: string): Promise<AdminDocument | null> {
  const [row] = await db
    .select(documentSelection)
    .from(documents)
    .innerJoin(users, eq(documents.authorId, users.id))
    .where(eq(documents.id, id))
    .limit(1);
  return row ? toAdminDocument(row) : null;
}

async function ensureTaxonomyReferences(tx: Transaction, data: DocumentData): Promise<void> {
  if (data.categoryId) {
    const [category] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, data.categoryId)).limit(1);
    if (!category) throw new ValidationError('所选分类不存在或已删除。');
  }
  if (data.tagIds.length > 0) {
    const rows = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, data.tagIds));
    if (rows.length !== data.tagIds.length) throw new ValidationError('有标签不存在或已删除。');
  }
}

async function syncTaxonomyReferences(tx: Transaction, documentId: string, data: DocumentData): Promise<void> {
  await tx.delete(documentCategories).where(eq(documentCategories.documentId, documentId));
  await tx.delete(documentTags).where(eq(documentTags.documentId, documentId));
  if (data.categoryId) {
    await tx.insert(documentCategories).values({ documentId, categoryId: data.categoryId });
  }
  if (data.tagIds.length > 0) {
    await tx.insert(documentTags).values(data.tagIds.map((tagId) => ({ documentId, tagId })));
  }
}

async function recordAudit(
  tx: Transaction,
  actorId: string,
  action: string,
  resourceId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLog).values({ actorId, action, resourceId, detail });
}

async function authorNameFor(tx: Transaction, authorId: string): Promise<string> {
  const [author] = await tx.select({ name: users.name }).from(users).where(eq(users.id, authorId)).limit(1);
  if (!author) throw new ValidationError('文档作者不存在。');
  return author.name;
}

function resultFromRow(row: typeof documents.$inferSelect, authorName: string): AdminDocument {
  return toAdminDocument({ ...row, authorName });
}

/** Returns only documents the signed-in user may manage. */
export async function getAdminDocuments(filters: DocumentFilters = {}): Promise<AdminDocument[]> {
  const user = await requireUser();
  assertDatabase();

  const kind = filters.kind === 'post' || filters.kind === 'page' ? filters.kind : undefined;
  const status =
    filters.status === 'trash' || filters.status === 'archived'
      ? 'archived'
      : filters.status === 'draft' || filters.status === 'review' || filters.status === 'published'
        ? filters.status
      : undefined;
  const query = typeof filters.q === 'string' ? filters.q.trim().slice(0, 100) : '';
  const conditions = [];
  if (kind) conditions.push(eq(documents.kind, kind));
  if (status) {
    conditions.push(eq(documents.status, status));
    if (status !== 'archived') conditions.push(isNull(documents.deletedAt));
  } else {
    conditions.push(isNull(documents.deletedAt));
  }
  if (!canEditAll(user)) {
    conditions.push(eq(documents.authorId, user.id));
    conditions.push(eq(documents.kind, 'post'));
  }

  const rows = await db
    .select(documentSelection)
    .from(documents)
    .innerJoin(users, eq(documents.authorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(documents.updatedAt));

  return rows.flatMap((row) => {
    try {
      const document = toAdminDocument(row);
      return matchesSearch(document, query) ? [document] : [];
    } catch {
      return [];
    }
  });
}

export async function getDashboard(): Promise<DashboardData> {
  const recent = await getAdminDocuments();
  return {
    total: recent.length,
    drafts: recent.filter((document) => document.status === 'draft').length,
    review: recent.filter((document) => document.status === 'review').length,
    published: recent.filter((document) => document.status === 'published').length,
    recent: recent.slice(0, 8),
  };
}

export async function getAdminDocument(id: string): Promise<AdminDocument | null> {
  const user = await requireUser();
  assertDatabase();
  const document = await findDocument(ensureDocumentId(id));
  return document && canAccessDocument(user, document) ? document : null;
}

export async function getRevisions(id: string): Promise<DocumentRevision[]> {
  const user = await requireUser();
  assertDatabase();
  const document = await findDocument(ensureDocumentId(id));
  if (!document || !canAccessDocument(user, document)) return [];

  const rows = await db
    .select({
      id: revisions.id,
      documentId: revisions.documentId,
      version: revisions.version,
      data: revisions.data,
      actorName: users.name,
      createdAt: revisions.createdAt,
      note: revisions.note,
    })
    .from(revisions)
    .innerJoin(users, eq(revisions.actorId, users.id))
    .where(eq(revisions.documentId, document.id))
    .orderBy(desc(revisions.version));

  return rows.flatMap((row) => {
    try {
      return [{
        id: row.id,
        documentId: row.documentId,
        version: row.version,
        data: validateDocumentData(document.kind, row.data, {
          allowDemo: true,
          allowSeedFixtures: process.env.NODE_ENV !== 'production',
        }),
        actorName: row.actorName,
        createdAt: row.createdAt.toISOString(),
        note: row.note,
      }];
    } catch {
      return [];
    }
  });
}

export async function saveDocument(input: SaveDocumentInput): Promise<ActionResult<AdminDocument>> {
  const user = await requireMutationUser();
  assertDatabase();
  try {
    if (!isPlainObject(input)) throw new ValidationError('文档数据不正确。');
    const kind = ensureDocumentKind(input.kind);
    if (!canCreateKind(user, kind)) return failure('你没有创建静态页面的权限。', 'FORBIDDEN');
    const data = validateDocumentData(kind, input.data);

    const result = await db.transaction(async (tx) => {
      if (!input.id) {
        await ensureTaxonomyReferences(tx, data);
        const [created] = await tx
          .insert(documents)
          .values({ kind, status: 'draft', authorId: user.id, draft: data, version: 1 })
          .returning();
        if (!created) throw new ValidationError('无法创建文档。');
        await syncTaxonomyReferences(tx, created.id, data);
        await tx.insert(revisions).values({ documentId: created.id, version: created.version, data, actorId: user.id, note: '创建文档' });
        await recordAudit(tx, user.id, 'document.create', created.id, { kind });
        return { ok: true as const, data: resultFromRow(created, user.name) };
      }

      const id = ensureDocumentId(input.id);
      const expectedVersion = ensureExpectedVersion(input.expectedVersion);
      const [current] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1);
      if (!current) return failure<AdminDocument>('文档不存在或已被删除。', 'NOT_FOUND');
      if (current.kind !== kind) return failure<AdminDocument>('文档类型不能修改。', 'VALIDATION');
      if (!canAccessDocument(user, current)) return failure<AdminDocument>('你没有编辑此文档的权限。', 'FORBIDDEN');
      if (current.status === 'archived') return failure<AdminDocument>('请先恢复回收站中的文档。', 'ARCHIVED');

      await ensureTaxonomyReferences(tx, data);
      const [updated] = await tx
        .update(documents)
        .set({ draft: data, version: sql`${documents.version} + 1`, updatedAt: new Date() })
        .where(and(eq(documents.id, id), eq(documents.version, expectedVersion)))
        .returning();
      if (!updated) return failure<AdminDocument>('文档已被其他人更新，请刷新后重试。', 'CONFLICT');
      await syncTaxonomyReferences(tx, id, data);
      await tx.insert(revisions).values({ documentId: id, version: updated.version, data, actorId: user.id, note: '保存草稿' });
      await recordAudit(tx, user.id, 'document.save', id, { version: updated.version });
      return { ok: true as const, data: resultFromRow(updated, await authorNameFor(tx, updated.authorId)) };
    });

    if (result.ok) revalidatePublicContent();
    return result;
  } catch (error) {
    const result = safeActionError(error, '保存文档失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}

export async function transitionDocument(input: TransitionInput): Promise<ActionResult<AdminDocument | undefined>> {
  const user = await requireMutationUser();
  assertDatabase();
  try {
    if (!isPlainObject(input)) throw new ValidationError('文档操作不正确。');
    const id = ensureDocumentId(input.id);
    const expectedVersion = ensureExpectedVersion(input.expectedVersion);
    const action = ensureTransitionAction(input.action);
    const note = ensureNote(input.note);
    // Resolving a disabled delivery configuration is harmless and returns null. The actual mail
    // setting is checked again inside the publication transaction before any outbox write.
    const automaticDelivery = action === 'publish' ? await prepareAutomaticPostDelivery() : null;
    let shouldKickMailWorker = false;

    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1);
      if (!current) return failure<AdminDocument | undefined>('文档不存在或已被删除。', 'NOT_FOUND');
      if (action === 'delete') {
        if (user.role !== 'admin') return failure<AdminDocument | undefined>('只有管理员可以永久删除文档。', 'FORBIDDEN');
        const [deleted] = await tx
          .delete(documents)
          .where(and(eq(documents.id, id), eq(documents.version, expectedVersion)))
          .returning({ id: documents.id });
        if (!deleted) return failure<AdminDocument | undefined>('文档已被其他人更新，请刷新后重试。', 'CONFLICT');
        if (current.kind === 'post') {
          await suppressPostMailJobs(tx, { documentId: id, reason: 'POST_UNPUBLISHED' });
          shouldKickMailWorker = true;
        }
        await recordAudit(tx, user.id, 'document.delete', id, { note });
        return { ok: true as const, data: undefined };
      }
      if (!canAccessDocument(user, current)) return failure<AdminDocument | undefined>('你没有操作此文档的权限。', 'FORBIDDEN');

      const draft = validateDocumentData(current.kind, current.draft, {
        allowDemo: true,
        allowSeedFixtures: process.env.NODE_ENV !== 'production',
      });
      const now = new Date();
      let patch: Partial<typeof documents.$inferInsert>;
      switch (action) {
        case 'submit':
          if (current.status !== 'draft' && current.status !== 'published') {
            return failure<AdminDocument | undefined>('只有草稿或已发布文档的新修订可以提交审核。', 'INVALID_STATE');
          }
          patch = { status: 'review' };
          break;
        case 'return':
          if (!canEditAll(user)) return failure<AdminDocument | undefined>('只有编辑或管理员可以退回审核。', 'FORBIDDEN');
          if (current.status !== 'review') return failure<AdminDocument | undefined>('只有审核中的文档可以退回。', 'INVALID_STATE');
          patch = { status: 'draft' };
          break;
        case 'publish':
          if (!canEditAll(user)) return failure<AdminDocument | undefined>('只有编辑或管理员可以发布文档。', 'FORBIDDEN');
          if (current.status !== 'draft' && current.status !== 'review' && current.status !== 'published') {
            return failure<AdminDocument | undefined>('只有草稿、审核中或已发布的文档可以发布。', 'INVALID_STATE');
          }
          await ensureTaxonomyReferences(tx, draft);
          patch = { status: 'published', published: draft, publishedSlug: draft.slug, publishedAt: now, deletedAt: null };
          break;
        case 'unpublish':
          if (!canEditAll(user)) return failure<AdminDocument | undefined>('只有编辑或管理员可以取消发布。', 'FORBIDDEN');
          if (!current.published || current.status === 'archived') {
            return failure<AdminDocument | undefined>('该文档没有可撤回的公开版本。', 'INVALID_STATE');
          }
          patch = { status: 'draft', published: null, publishedSlug: null, publishedAt: null };
          break;
        case 'trash':
          if (current.status === 'archived') return failure<AdminDocument | undefined>('文档已在回收站中。', 'INVALID_STATE');
          if (current.published && !canEditAll(user)) {
            return failure<AdminDocument | undefined>('只有编辑或管理员可以隐藏已有公开版本。', 'FORBIDDEN');
          }
          patch = { status: 'archived', deletedAt: now };
          break;
        case 'restore':
          if (current.status !== 'archived') return failure<AdminDocument | undefined>('只有回收站中的文档可以恢复。', 'INVALID_STATE');
          if (current.published && !canEditAll(user)) {
            return failure<AdminDocument | undefined>('只有编辑或管理员可以恢复已有公开版本。', 'FORBIDDEN');
          }
          // A restored document with a prior published snapshot resumes publication of that
          // immutable snapshot. A never-published document returns to its draft workflow.
          patch = { status: current.published ? 'published' : 'draft', deletedAt: null };
          break;
        default:
          return failure<AdminDocument | undefined>('不支持的文档操作。', 'VALIDATION');
      }

      const [updated] = await tx
        .update(documents)
        .set({ ...patch, version: sql`${documents.version} + 1`, updatedAt: now })
        .where(and(eq(documents.id, id), eq(documents.version, expectedVersion)))
        .returning();
      if (!updated) return failure<AdminDocument | undefined>('文档已被其他人更新，请刷新后重试。', 'CONFLICT');
      if (current.kind === 'post' && (action === 'unpublish' || action === 'trash')) {
        await suppressPostMailJobs(tx, { documentId: id, reason: 'POST_UNPUBLISHED' });
        shouldKickMailWorker = true;
      }
      if (action === 'publish' && current.kind === 'post' && !current.published && updated.published && updated.publishedAt) {
        const queued = await recordInitialPublishedPost(tx, {
          documentId: updated.id,
          snapshot: updated.published,
          publishedAt: updated.publishedAt,
          delivery: automaticDelivery,
        });
        if (queued > 0) shouldKickMailWorker = true;
      }
      await tx.insert(revisions).values({
        documentId: id,
        version: updated.version,
        data: draft,
        actorId: user.id,
        note: note || action,
      });
      await recordAudit(tx, user.id, `document.${action}`, id, { version: updated.version, note });
      return { ok: true as const, data: resultFromRow(updated, await authorNameFor(tx, updated.authorId)) };
    });

    if (result.ok) revalidatePublicContent();
    if (result.ok && shouldKickMailWorker) kickMailWorker();
    return result;
  } catch (error) {
    const result = safeActionError(error, '更新文档状态失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}

export async function restoreRevision(
  id: string,
  revisionId: string,
  expectedVersion: number,
): Promise<ActionResult<AdminDocument>> {
  const user = await requireMutationUser();
  assertDatabase();
  try {
    const documentId = ensureDocumentId(id);
    const safeRevisionId = ensureDocumentId(revisionId);
    const version = ensureExpectedVersion(expectedVersion);
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(documents).where(eq(documents.id, documentId)).limit(1);
      if (!current) return failure<AdminDocument>('文档不存在或已被删除。', 'NOT_FOUND');
      if (!canAccessDocument(user, current)) return failure<AdminDocument>('你没有恢复此文档版本的权限。', 'FORBIDDEN');
      if (current.status === 'archived') return failure<AdminDocument>('请先恢复回收站中的文档。', 'ARCHIVED');
      const [revision] = await tx
        .select({ data: revisions.data, version: revisions.version })
        .from(revisions)
        .where(and(eq(revisions.id, safeRevisionId), eq(revisions.documentId, documentId)))
        .limit(1);
      if (!revision) return failure<AdminDocument>('找不到指定的历史版本。', 'NOT_FOUND');
      const data = validateDocumentData(current.kind, revision.data, {
        allowDemo: true,
        allowSeedFixtures: process.env.NODE_ENV !== 'production',
      });
      await ensureTaxonomyReferences(tx, data);
      const [updated] = await tx
        .update(documents)
        .set({ draft: data, version: sql`${documents.version} + 1`, updatedAt: new Date() })
        .where(and(eq(documents.id, documentId), eq(documents.version, version)))
        .returning();
      if (!updated) return failure<AdminDocument>('文档已被其他人更新，请刷新后重试。', 'CONFLICT');
      await syncTaxonomyReferences(tx, documentId, data);
      await tx.insert(revisions).values({
        documentId,
        version: updated.version,
        data,
        actorId: user.id,
        note: `恢复版本 ${revision.version}`,
      });
      await recordAudit(tx, user.id, 'document.restore_revision', documentId, {
        restoredRevisionId: safeRevisionId,
        version: updated.version,
      });
      return { ok: true as const, data: resultFromRow(updated, await authorNameFor(tx, updated.authorId)) };
    });
    if (result.ok) revalidatePublicContent();
    return result;
  } catch (error) {
    const result = safeActionError(error, '恢复历史版本失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}
