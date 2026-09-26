import 'server-only';

import { eq, sql } from 'drizzle-orm';

import type { ActionResult } from '@/lib/cms/types';
import { ValidationError } from '@/lib/cms/validation';
import { assertDatabase } from '@/lib/cms/internal';
import { db } from '@/lib/db';
import { auditLog, settings } from '@/lib/db/schema';
import type { RichNode } from '@/lib/content/types';

import { defaultSpecialPageContent } from './defaults';
import { type StoredSpecialPage, type StoredSpecialPages, validateSpecialPageKey, validateStoredSpecialPages } from './validation';
import {
  SPECIAL_PAGE_KEYS,
  SPECIAL_PAGE_SETTINGS_KEY,
  SPECIAL_PAGE_TITLES,
  type AdminSpecialPage,
  type PublicSpecialPage,
  type SpecialPageContent,
  type SpecialPageKey,
} from './types';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function failure<T = undefined>(error: string, code?: string): ActionResult<T> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

function absentPage(key: SpecialPageKey): StoredSpecialPage {
  return {
    draft: defaultSpecialPageContent(key),
    published: null,
    version: 0,
    updatedAt: null,
    publishedAt: null,
  };
}

function absentPages(): StoredSpecialPages {
  return {
    schemaVersion: 1,
    pages: Object.fromEntries(SPECIAL_PAGE_KEYS.map((key) => [key, absentPage(key)])) as Record<SpecialPageKey, StoredSpecialPage>,
  };
}

function toAdminPage(key: SpecialPageKey, page: StoredSpecialPage): AdminSpecialPage {
  return {
    key,
    title: SPECIAL_PAGE_TITLES[key],
    draft: page.draft,
    published: page.published,
    version: page.version,
    updatedAt: page.updatedAt,
    publishedAt: page.publishedAt,
  };
}

function readStoredValue(value: unknown): StoredSpecialPages | null {
  try {
    return validateStoredSpecialPages(value);
  } catch {
    return null;
  }
}

async function readStoredPages(): Promise<StoredSpecialPages | null> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SPECIAL_PAGE_SETTINGS_KEY)).limit(1);
  return row ? readStoredValue(row.value) : null;
}

function storedForDisplay(stored: StoredSpecialPages | null): StoredSpecialPages {
  return stored ?? absentPages();
}

/** This server-only helper intentionally returns only the two fixed page records. */
export async function readAdminSpecialPages(): Promise<AdminSpecialPage[]> {
  assertDatabase();
  const pages = storedForDisplay(await readStoredPages());
  return SPECIAL_PAGE_KEYS.map((key) => toAdminPage(key, pages.pages[key]));
}

export async function readAdminSpecialPage(key: SpecialPageKey): Promise<AdminSpecialPage> {
  assertDatabase();
  const pages = storedForDisplay(await readStoredPages());
  return toAdminPage(key, pages.pages[key]);
}

/**
 * Public callers only receive an immutable published snapshot. A malformed row and an unsaved
 * draft both fall back to reviewed built-in copy, so no private draft data reaches a page route.
 */
export async function getPublicSpecialPage(key: SpecialPageKey): Promise<PublicSpecialPage> {
  assertDatabase();
  const validatedKey = validateSpecialPageKey(key);
  const stored = await readStoredPages();
  const page = stored?.pages[validatedKey];
  const published = page?.published;
  const content = published ?? defaultSpecialPageContent(validatedKey);
  return {
    key: validatedKey,
    title: SPECIAL_PAGE_TITLES[validatedKey],
    intro: content.intro,
    body: content.body,
    publishedAt: published ? page?.publishedAt ?? null : null,
  };
}

/**
 * Used by the media service: `published` determines anonymous media access, while `all`
 * protects uploads referenced by drafts as well as published snapshots from deletion.
 */
export async function getSpecialPageMediaReferences(): Promise<{ published: RichNode[]; all: RichNode[] }> {
  assertDatabase();
  const stored = await readStoredPages();
  if (!stored) return { published: [], all: [] };

  const published: RichNode[] = [];
  const all: RichNode[] = [];
  for (const key of SPECIAL_PAGE_KEYS) {
    const page = stored.pages[key];
    all.push(page.draft.body);
    if (page.published) {
      published.push(page.published.body);
      all.push(page.published.body);
    }
  }
  return { published, all };
}

async function lockSpecialPages(tx: Transaction): Promise<void> {
  // The settings row may not exist on first save, so a row lock alone cannot serialize creation.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${SPECIAL_PAGE_SETTINGS_KEY}))`);
}

async function readStoredPagesForWrite(tx: Transaction): Promise<StoredSpecialPages> {
  const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, SPECIAL_PAGE_SETTINGS_KEY)).limit(1);
  if (!row) return absentPages();
  try {
    return validateStoredSpecialPages(row.value);
  } catch {
    // Do not overwrite an unknown settings record merely because a user submitted an edit.
    throw new ValidationError('专页设置记录无法读取，请联系管理员检查后重试。');
  }
}

async function persistPages(tx: Transaction, pages: StoredSpecialPages, actorId: string, action: string, key: SpecialPageKey): Promise<void> {
  await tx
    .insert(settings)
    .values({ key: SPECIAL_PAGE_SETTINGS_KEY, value: pages, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value: pages, updatedAt: new Date() } });
  await tx.insert(auditLog).values({
    actorId,
    action,
    resourceId: `${SPECIAL_PAGE_SETTINGS_KEY}:${key}`,
    detail: { key, version: pages.pages[key].version },
  });
}

export async function saveStoredSpecialPage(
  key: SpecialPageKey,
  expectedVersion: number,
  draft: SpecialPageContent,
  actorId: string,
): Promise<ActionResult<AdminSpecialPage>> {
  return db.transaction(async (tx) => {
    await lockSpecialPages(tx);
    const pages = await readStoredPagesForWrite(tx);
    const current = pages.pages[key];
    if (current.version !== expectedVersion) {
      return failure<AdminSpecialPage>('专页已被其他人更新，请刷新后重试。', 'CONFLICT');
    }

    const now = new Date().toISOString();
    const next: StoredSpecialPages = {
      ...pages,
      pages: {
        ...pages.pages,
        [key]: { ...current, draft, version: current.version + 1, updatedAt: now },
      },
    };
    await persistPages(tx, next, actorId, 'special_page.save', key);
    return { ok: true, data: toAdminPage(key, next.pages[key]) };
  });
}

export async function publishStoredSpecialPage(
  key: SpecialPageKey,
  expectedVersion: number,
  actorId: string,
): Promise<ActionResult<AdminSpecialPage>> {
  return db.transaction(async (tx) => {
    await lockSpecialPages(tx);
    const pages = await readStoredPagesForWrite(tx);
    const current = pages.pages[key];
    if (current.version !== expectedVersion) {
      return failure<AdminSpecialPage>('专页已被其他人更新，请刷新后重试。', 'CONFLICT');
    }

    const now = new Date().toISOString();
    const next: StoredSpecialPages = {
      ...pages,
      pages: {
        ...pages.pages,
        [key]: {
          ...current,
          published: current.draft,
          version: current.version + 1,
          updatedAt: now,
          publishedAt: now,
        },
      },
    };
    await persistPages(tx, next, actorId, 'special_page.publish', key);
    return { ok: true, data: toAdminPage(key, next.pages[key]) };
  });
}
