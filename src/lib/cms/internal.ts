import 'server-only';

import { revalidatePath } from 'next/cache';

import type { AdminDocument, AdminUser, DocumentData, DocumentKind, DocumentStatus } from './types';
import { ValidationError, validateDocumentData } from './validation';
import { assertDatabaseConfigured } from '@/lib/db';

type StoredDocumentRow = {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  version: number;
  draft: DocumentData;
  published: DocumentData | null;
  authorId: string;
  authorName: string;
  publishedAt: Date | null;
  updatedAt: Date;
  deletedAt: Date | null;
};

export function assertDatabase(): void {
  assertDatabaseConfigured();
}

export function toIsoDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function readStoredData(kind: DocumentKind, data: DocumentData): DocumentData {
  return validateDocumentData(kind, data, {
    allowDemo: true,
    allowSeedFixtures: process.env.NODE_ENV !== 'production',
  });
}

export function toAdminDocument(row: StoredDocumentRow): AdminDocument {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    version: row.version,
    draft: readStoredData(row.kind, row.draft),
    published: row.published ? readStoredData(row.kind, row.published) : null,
    authorId: row.authorId,
    authorName: row.authorName,
    publishedAt: toIsoDate(row.publishedAt),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: toIsoDate(row.deletedAt),
  };
}

export function canEditAll(user: AdminUser): boolean {
  return user.role === 'admin' || user.role === 'editor';
}

export function canAccessDocument(user: AdminUser, document: Pick<AdminDocument, 'authorId' | 'kind' | 'status'>): boolean {
  if (canEditAll(user)) return true;
  // Authors may revise their own published posts. The public renderer reads the immutable
  // published snapshot, so changing a draft never changes what visitors can see.
  return document.kind === 'post' && document.authorId === user.id;
}

export function canCreateKind(user: AdminUser, kind: DocumentKind): boolean {
  return kind === 'post' || canEditAll(user);
}

export function versionOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function safeActionError(error: unknown, fallback: string): { error: string; code?: string } {
  if (error instanceof ValidationError) return { error: error.message, code: 'VALIDATION' };
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === '23505') return { error: '该 URL 标识或名称已被使用，请换一个。', code: 'DUPLICATE' };
    if (code === '23503') return { error: '关联的数据不存在或仍被使用。', code: 'REFERENCE' };
  }
  return { error: fallback, code: 'INTERNAL' };
}

/** Content pages are dynamic, but invalidating them keeps future cache settings safe. */
export function revalidatePublicContent(): void {
  try {
    revalidatePath('/', 'layout');
    revalidatePath('/', 'page');
    revalidatePath('/search', 'page');
    revalidatePath('/members', 'page');
  } catch {
    // Unit tests and non-Next scripts do not have an incremental cache available.
  }
}
