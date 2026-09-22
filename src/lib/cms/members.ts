'use server';

import { asc, eq } from 'drizzle-orm';

import type { ActionResult, Member, MemberInput } from './types';
import { assertDatabase, revalidatePublicContent, safeActionError } from './internal';
import { ValidationError, isPlainObject, validateMemberInput } from './validation';
import { requireMutationUser, requireRole } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { auditLog, documents, members } from '@/lib/db/schema';

function failure<T = undefined>(error: string, code?: string): ActionResult<T> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

function toMember(row: typeof members.$inferSelect): Member {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    interests: row.interests,
    links: row.links,
    order: row.order,
  };
}

function ensureId(value: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new ValidationError('成员 ID 不正确。');
  return value;
}

function containsMemberReference(value: unknown, id: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const document = value as { blocks?: unknown };
  if (!Array.isArray(document.blocks)) return false;
  return document.blocks.some((block) => {
    if (!block || typeof block !== 'object') return false;
    const memberIds = (block as { memberIds?: unknown }).memberIds;
    return Array.isArray(memberIds) && memberIds.includes(id);
  });
}

export async function getAdminMembers(): Promise<Member[]> {
  await requireRole(['admin', 'editor']);
  assertDatabase();
  const rows = await db.select().from(members).orderBy(asc(members.order), asc(members.name));
  return rows.map(toMember);
}

export async function saveMember(input: MemberInput): Promise<ActionResult<Member>> {
  const user = await requireMutationUser(['admin', 'editor']);
  assertDatabase();
  try {
    if (!isPlainObject(input)) throw new ValidationError('成员资料不正确。');
    const value = validateMemberInput(input);
    let saved: typeof members.$inferSelect | undefined;
    if (value.id) {
      const id = ensureId(value.id);
      const [existing] = await db.select({ id: members.id }).from(members).where(eq(members.id, id)).limit(1);
      if (!existing) return failure('成员不存在。', 'NOT_FOUND');
      [saved] = await db
        .update(members)
        .set({
          name: value.name,
          role: value.role,
          bio: value.bio,
          avatarUrl: value.avatarUrl,
          interests: value.interests,
          links: value.links,
          order: value.order,
          updatedAt: new Date(),
        })
        .where(eq(members.id, id))
        .returning();
    } else {
      [saved] = await db
        .insert(members)
        .values({
          name: value.name,
          role: value.role,
          bio: value.bio,
          avatarUrl: value.avatarUrl,
          interests: value.interests,
          links: value.links,
          order: value.order,
        })
        .returning();
    }
    if (!saved) return failure('无法保存成员资料。', 'INTERNAL');
    await db.insert(auditLog).values({
      actorId: user.id,
      action: value.id ? 'member.update' : 'member.create',
      resourceId: saved.id,
      detail: { name: saved.name },
    });
    revalidatePublicContent();
    return { ok: true, data: toMember(saved) };
  } catch (error) {
    const result = safeActionError(error, '保存成员资料失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}

export async function deleteMember(id: string): Promise<ActionResult> {
  const user = await requireMutationUser(['admin', 'editor']);
  assertDatabase();
  try {
    const memberId = ensureId(id);
    const [[existing], documentRows] = await Promise.all([
      db.select({ id: members.id, name: members.name }).from(members).where(eq(members.id, memberId)).limit(1),
      db.select({ draft: documents.draft, published: documents.published }).from(documents),
    ]);
    if (!existing) return failure('成员不存在。', 'NOT_FOUND');
    if (documentRows.some((document) => containsMemberReference(document.draft, memberId) || containsMemberReference(document.published, memberId))) {
      return failure(`“${existing.name}”仍被页面引用，请先移除引用。`, 'REFERENCED');
    }
    const [deleted] = await db.delete(members).where(eq(members.id, memberId)).returning({ id: members.id });
    if (!deleted) return failure('成员不存在。', 'NOT_FOUND');
    await db.insert(auditLog).values({ actorId: user.id, action: 'member.delete', resourceId: memberId, detail: {} });
    revalidatePublicContent();
    return { ok: true, data: undefined };
  } catch (error) {
    const result = safeActionError(error, '删除成员失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}
