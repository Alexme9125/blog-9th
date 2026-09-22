'use server';

import { eq } from 'drizzle-orm';

import type { ActionResult, SiteSettings } from './types';
import { defaultSiteSettings, SITE_SETTINGS_KEY } from './defaults';
import { assertDatabase, revalidatePublicContent, safeActionError } from './internal';
import { ValidationError, validateSettingsInput } from './validation';
import { requireMutationUser, requireRole } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { auditLog, settings } from '@/lib/db/schema';

function failure<T = undefined>(error: string, code?: string): ActionResult<T> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

async function readSettings(): Promise<SiteSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SITE_SETTINGS_KEY)).limit(1);
  if (!row) return defaultSiteSettings;
  try {
    return validateSettingsInput(row.value);
  } catch {
    return defaultSiteSettings;
  }
}

async function persistSettings(value: SiteSettings): Promise<void> {
  await db
    .insert(settings)
    .values({ key: SITE_SETTINGS_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function getAdminSettings(): Promise<SiteSettings> {
  await requireRole(['admin']);
  assertDatabase();
  return readSettings();
}

export async function saveSettings(input: SiteSettings): Promise<ActionResult<SiteSettings>> {
  const user = await requireMutationUser(['admin']);
  assertDatabase();
  try {
    const current = await readSettings();
    const value = validateSettingsInput(input, current.navigation);
    await persistSettings(value);
    await db.insert(auditLog).values({ actorId: user.id, action: 'settings.save', resourceId: SITE_SETTINGS_KEY, detail: {} });
    revalidatePublicContent();
    return { ok: true, data: value };
  } catch (error) {
    const result = safeActionError(error, '保存站点设置失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}

/** Editors can update the public members-page introduction without site-wide settings access. */
export async function saveMembersIntro(text: string): Promise<ActionResult<SiteSettings>> {
  const user = await requireMutationUser(['admin', 'editor']);
  assertDatabase();
  try {
    if (typeof text !== 'string') throw new ValidationError('成员页介绍必须是文本。');
    const current = await readSettings();
    const value = validateSettingsInput({ ...current, membersIntro: text }, current.navigation);
    await persistSettings(value);
    await db.insert(auditLog).values({ actorId: user.id, action: 'settings.members_intro', resourceId: SITE_SETTINGS_KEY, detail: {} });
    revalidatePublicContent();
    return { ok: true, data: value };
  } catch (error) {
    const result = safeActionError(error, '保存成员页介绍失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}
