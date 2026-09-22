'use server';

import 'server-only';

import { randomUUID } from 'node:crypto';

import { hashPassword } from 'better-auth/crypto';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';

import {
  getAuth,
  requireMutationUser,
  requireRole,
  requireUser,
} from '@/lib/auth/server';
import { assertDatabaseConfigured, db } from '@/lib/db';
import { accounts, auditLog, sessions, users } from '@/lib/db/schema';
import type { ActionResult, AdminUser, UserInput } from './types';

const passwordSchema = z.string().min(12, '密码至少需要 12 个字符。').max(128, '密码最多 128 个字符。');

const userInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, '请输入姓名。').max(120, '姓名最多 120 个字符。'),
  email: z.string().trim().email('请输入有效的邮箱地址。').max(320).transform((value) => value.toLowerCase()),
  role: z.enum(['admin', 'editor', 'author']),
  disabled: z.boolean().optional(),
  password: passwordSchema.optional(),
});

const idSchema = z.string().min(1);
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toAdminUser(user: typeof users.$inferSelect): AdminUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    mustChangePassword: user.mustChangePassword,
  };
}

function failure(error: string, code?: string): ActionResult<never> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

async function activeAdminCount(tx: Transaction): Promise<number> {
  const [result] = await tx
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, false)));

  return Number(result?.total ?? 0);
}

async function credentialAccount(tx: Transaction, userId: string) {
  const [account] = await tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, 'credential'),
        eq(accounts.accountId, userId),
      ),
    )
    .limit(1);

  return account ?? null;
}

async function setCredentialPassword(tx: Transaction, userId: string, passwordHash: string): Promise<void> {
  const existingAccount = await credentialAccount(tx, userId);

  if (existingAccount) {
    await tx
      .update(accounts)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(accounts.id, existingAccount.id));
    return;
  }

  await tx.insert(accounts).values({
    id: randomUUID(),
    accountId: userId,
    providerId: 'credential',
    userId,
    password: passwordHash,
  });
}

export async function getUsers(): Promise<AdminUser[]> {
  assertDatabaseConfigured();
  await requireRole(['admin']);

  const rows = await db.select().from(users).orderBy(asc(users.name), asc(users.email));
  return rows.map(toAdminUser);
}

export async function saveUser(input: UserInput): Promise<ActionResult<AdminUser>> {
  assertDatabaseConfigured();
  const actor = await requireMutationUser(['admin']);
  const parsed = userInputSchema.safeParse(input);

  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? '用户信息无效。', 'VALIDATION_ERROR');
  }

  const value = parsed.data;

  if (!value.id && !value.password) {
    return failure('新用户必须设置初始密码。', 'PASSWORD_REQUIRED');
  }

  try {
    if (!value.id) {
      const id = randomUUID();
      const passwordHash = await hashPassword(value.password!);
      const created = await db.transaction(async (tx) => {
        const [newUser] = await tx
          .insert(users)
          .values({
            id,
            name: value.name,
            email: value.email,
            emailVerified: true,
            role: value.role,
            disabled: value.disabled ?? false,
            mustChangePassword: true,
          })
          .returning();

        if (!newUser) throw new Error('Unable to create user.');
        await setCredentialPassword(tx, id, passwordHash);
        await tx.insert(auditLog).values({
          actorId: actor.id,
          action: 'user.create',
          resourceId: id,
          detail: { role: newUser.role, disabled: newUser.disabled },
        });
        return newUser;
      });

      return { ok: true, data: toAdminUser(created) };
    }

    const passwordHash = value.password ? await hashPassword(value.password) : null;
    return db.transaction(async (tx) => {
      // Serialize administrator-count changes so two concurrent edits cannot remove every
      // active administrator between their respective count and update statements.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('darwin:active-admins'))`);

      const [existing] = await tx.select().from(users).where(eq(users.id, value.id!)).limit(1);
      if (!existing) return failure('找不到该用户。', 'NOT_FOUND');

      const nextDisabled = value.disabled ?? existing.disabled;
      const demotingLastAdmin = existing.role === 'admin' && value.role !== 'admin';
      const disablingLastAdmin = existing.role === 'admin' && !existing.disabled && nextDisabled;

      if ((demotingLastAdmin || disablingLastAdmin) && (await activeAdminCount(tx)) <= 1) {
        return failure('不能降权或停用最后一个管理员。', 'LAST_ADMIN');
      }

      const [updated] = await tx
        .update(users)
        .set({
          name: value.name,
          email: value.email,
          role: value.role,
          disabled: nextDisabled,
          ...(passwordHash ? { mustChangePassword: true } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();

      if (!updated) return failure('无法保存用户。', 'UPDATE_FAILED');
      if (passwordHash) await setCredentialPassword(tx, existing.id, passwordHash);
      if (nextDisabled && !existing.disabled) await tx.delete(sessions).where(eq(sessions.userId, existing.id));
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'user.update',
        resourceId: existing.id,
        detail: { role: updated.role, disabled: updated.disabled, passwordReset: Boolean(passwordHash) },
      });

      return { ok: true, data: toAdminUser(updated) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return failure('该邮箱已被使用。', 'DUPLICATE_EMAIL');
    }

    return failure('保存用户时发生错误。', 'SAVE_FAILED');
  }
}

export async function resetUserPassword(id: string, password: string): Promise<ActionResult> {
  assertDatabaseConfigured();
  const actor = await requireMutationUser(['admin']);
  const validId = idSchema.safeParse(id);
  const validPassword = passwordSchema.safeParse(password);

  if (!validId.success || !validPassword.success) {
    return failure(validPassword.error?.issues[0]?.message ?? '密码或用户标识无效。', 'VALIDATION_ERROR');
  }

  const [target] = await db.select().from(users).where(eq(users.id, validId.data)).limit(1);
  if (!target) {
    return failure('找不到该用户。', 'NOT_FOUND');
  }

  try {
    const passwordHash = await hashPassword(validPassword.data);
    await db.transaction(async (tx) => {
      await setCredentialPassword(tx, target.id, passwordHash);
      await tx
        .update(users)
        .set({ mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, target.id));
      await tx.delete(sessions).where(eq(sessions.userId, target.id));
      await tx.insert(auditLog).values({ actorId: actor.id, action: 'user.reset_password', resourceId: target.id, detail: {} });
    });

    return { ok: true, data: undefined };
  } catch {
    return failure('重置密码时发生错误。', 'RESET_FAILED');
  }
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<ActionResult> {
  assertDatabaseConfigured();
  const actor = await requireUser();
  const validCurrentPassword = passwordSchema.safeParse(currentPassword);
  const validNewPassword = passwordSchema.safeParse(newPassword);

  if (!validCurrentPassword.success || !validNewPassword.success) {
    return failure(validNewPassword.error?.issues[0]?.message ?? '密码无效。', 'VALIDATION_ERROR');
  }

  if (currentPassword === newPassword) {
    return failure('新密码必须与当前密码不同。', 'PASSWORD_UNCHANGED');
  }

  try {
    await getAuth().api.changePassword({
      headers: await headers(),
      body: {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      },
    });

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ mustChangePassword: false, updatedAt: new Date() })
        .where(eq(users.id, actor.id));
      // The password endpoint may mint a replacement current session. Remove it as well so the
      // browser is forced through a clean login after a mandatory password change.
      await tx.delete(sessions).where(eq(sessions.userId, actor.id));
      await tx.insert(auditLog).values({ actorId: actor.id, action: 'user.change_password', resourceId: actor.id, detail: {} });
    });

    return { ok: true, data: undefined };
  } catch {
    return failure('当前密码不正确或密码更新失败。', 'CHANGE_PASSWORD_FAILED');
  }
}
