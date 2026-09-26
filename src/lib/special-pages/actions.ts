'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/cms/types';
import { assertDatabase, safeActionError } from '@/lib/cms/internal';
import { requireMutationUser, requireRole } from '@/lib/auth/server';

import {
  publishStoredSpecialPage,
  readAdminSpecialPage,
  readAdminSpecialPages,
  saveStoredSpecialPage,
} from './store';
import {
  validateSpecialPageKey,
  validatePublishSpecialPageInput,
  validateSaveSpecialPageInput,
} from './validation';
import type {
  AdminSpecialPage,
  PublishSpecialPageInput,
  SaveSpecialPageInput,
  SpecialPageKey,
} from './types';

function failure<T = undefined>(error: string, code?: string): ActionResult<T> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

function revalidateSpecialPage(key: SpecialPageKey): void {
  try {
    revalidatePath(key === 'about' ? '/about' : '/privacy', 'page');
  } catch {
    // There is no incremental cache when these services run in integration tests or scripts.
  }
}

export async function getAdminSpecialPages(): Promise<AdminSpecialPage[]> {
  await requireRole(['admin', 'editor']);
  assertDatabase();
  return readAdminSpecialPages();
}

export async function getAdminSpecialPage(key: SpecialPageKey): Promise<AdminSpecialPage> {
  await requireRole(['admin', 'editor']);
  assertDatabase();
  return readAdminSpecialPage(validateSpecialPageKey(key));
}

export async function saveSpecialPage(input: SaveSpecialPageInput): Promise<ActionResult<AdminSpecialPage>> {
  const actor = await requireMutationUser(['admin', 'editor']);
  assertDatabase();
  try {
    const value = validateSaveSpecialPageInput(input);
    return await saveStoredSpecialPage(value.key, value.expectedVersion, { intro: value.intro, body: value.body }, actor.id);
  } catch (error) {
    const result = safeActionError(error, '保存专页草稿失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}

export async function publishSpecialPage(input: PublishSpecialPageInput): Promise<ActionResult<AdminSpecialPage>> {
  const actor = await requireMutationUser(['admin', 'editor']);
  assertDatabase();
  try {
    const value = validatePublishSpecialPageInput(input);
    const result = await publishStoredSpecialPage(value.key, value.expectedVersion, actor.id);
    if (result.ok) revalidateSpecialPage(value.key);
    return result;
  } catch (error) {
    const result = safeActionError(error, '发布专页失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}
