'use server';

import { asc, eq } from 'drizzle-orm';

import type { ActionResult, SaveTaxonomyInput, Taxonomy, TaxonomyData } from './types';
import { assertDatabase, revalidatePublicContent, safeActionError } from './internal';
import { ValidationError, isPlainObject, validateTaxonomyInput } from './validation';
import { requireMutationUser, requireUser } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { auditLog, categories, documents, documentCategories, documentTags, tags } from '@/lib/db/schema';

type TaxonomyRow = typeof categories.$inferSelect;

function failure<T = undefined>(error: string, code?: string): ActionResult<T> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

function toTaxonomy(row: TaxonomyRow): Taxonomy {
  return { id: row.id, name: row.name, slug: row.slug, ...(row.description ? { description: row.description } : {}) };
}

function ensureId(value: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new ValidationError('分类 ID 不正确。');
  return value;
}

function isTaxonomyReferenced(value: unknown, id: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const document = value as { categoryId?: unknown; tagIds?: unknown };
  return document.categoryId === id || (Array.isArray(document.tagIds) && document.tagIds.includes(id));
}

export async function getTaxonomy(): Promise<TaxonomyData> {
  await requireUser();
  assertDatabase();
  const [categoryRows, tagRows] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.name)),
    db.select().from(tags).orderBy(asc(tags.name)),
  ]);
  return { categories: categoryRows.map(toTaxonomy), tags: tagRows.map(toTaxonomy) };
}

export async function saveTaxonomy(input: SaveTaxonomyInput): Promise<ActionResult<Taxonomy>> {
  const user = await requireMutationUser(['admin', 'editor']);
  assertDatabase();
  try {
    if (!isPlainObject(input)) throw new ValidationError('分类数据不正确。');
    const value = validateTaxonomyInput(input);
    const table = value.kind === 'category' ? categories : tags;
    const now = new Date();
    let saved: TaxonomyRow | undefined;
    if (value.id) {
      const id = ensureId(value.id);
      const [existing] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
      if (!existing) return failure('分类或标签不存在。', 'NOT_FOUND');
      [saved] = await db
        .update(table)
        .set({ name: value.name, slug: value.slug, description: value.description ?? '', updatedAt: now })
        .where(eq(table.id, id))
        .returning();
    } else {
      [saved] = await db.insert(table).values({ name: value.name, slug: value.slug, description: value.description ?? '' }).returning();
    }
    if (!saved) return failure('无法保存分类或标签。', 'INTERNAL');
    await db.insert(auditLog).values({
      actorId: user.id,
      action: value.id ? `taxonomy.${value.kind}.update` : `taxonomy.${value.kind}.create`,
      resourceId: saved.id,
      detail: { slug: saved.slug },
    });
    revalidatePublicContent();
    return { ok: true, data: toTaxonomy(saved) };
  } catch (error) {
    const result = safeActionError(error, '保存分类或标签失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}

export async function deleteTaxonomy(id: string, kind: 'category' | 'tag'): Promise<ActionResult> {
  const user = await requireMutationUser(['admin', 'editor']);
  assertDatabase();
  try {
    const taxonomyId = ensureId(id);
    if (kind !== 'category' && kind !== 'tag') throw new ValidationError('分类类型不正确。');
    const table = kind === 'category' ? categories : tags;
    const joinTable = kind === 'category' ? documentCategories : documentTags;
    const joinColumn = kind === 'category' ? documentCategories.categoryId : documentTags.tagId;
    const [existing] = await db.select({ id: table.id, name: table.name }).from(table).where(eq(table.id, taxonomyId)).limit(1);
    if (!existing) return failure('分类或标签不存在。', 'NOT_FOUND');

    const [[joinReference], documentRows] = await Promise.all([
      db.select({ documentId: joinTable.documentId }).from(joinTable).where(eq(joinColumn, taxonomyId)).limit(1),
      db.select({ draft: documents.draft, published: documents.published }).from(documents),
    ]);
    if (joinReference || documentRows.some((document) => isTaxonomyReferenced(document.draft, taxonomyId) || isTaxonomyReferenced(document.published, taxonomyId))) {
      return failure(`“${existing.name}”仍被文档引用，请先移除引用。`, 'REFERENCED');
    }
    const [deleted] = await db.delete(table).where(eq(table.id, taxonomyId)).returning({ id: table.id });
    if (!deleted) return failure('分类或标签不存在。', 'NOT_FOUND');
    await db.insert(auditLog).values({ actorId: user.id, action: `taxonomy.${kind}.delete`, resourceId: taxonomyId, detail: {} });
    revalidatePublicContent();
    return { ok: true, data: undefined };
  } catch (error) {
    const result = safeActionError(error, '删除分类或标签失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}
