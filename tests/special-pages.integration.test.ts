import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminUser } from '@/lib/cms/types';
import type { RichNode } from '@/lib/content/types';
import { SPECIAL_PAGE_SETTINGS_KEY } from '@/lib/special-pages/types';
import * as schema from '@/lib/db/schema';

const runId = randomUUID().replaceAll('-', '');
const testDatabaseName = `darwin_special_pages_test_${runId}`;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalMediaDirectory = process.env.MEDIA_DIR;
const testMediaDirectory = resolve(process.cwd(), `.data/special-pages-test-media-${runId}`);

function configuredDatabaseUrl(): string | undefined {
  if (!process.env.DATABASE_URL && existsSync(resolve(process.cwd(), '.env.local'))) {
    process.loadEnvFile(resolve(process.cwd(), '.env.local'));
  }
  return process.env.DATABASE_URL?.trim() || undefined;
}

const sourceDatabaseUrl = configuredDatabaseUrl();
const databaseDescribe = sourceDatabaseUrl ? describe : describe.skip;

function databaseUrlFor(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function accessError(code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'PASSWORD_CHANGE_REQUIRED'): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

const admin: AdminUser = {
  id: `special-pages-admin-${runId}`,
  name: 'Special Pages Test Admin',
  email: `special-pages-admin-${runId}@example.test`,
  role: 'admin',
  disabled: false,
  mustChangePassword: false,
};
const editor: AdminUser = {
  id: `special-pages-editor-${runId}`,
  name: 'Special Pages Test Editor',
  email: `special-pages-editor-${runId}@example.test`,
  role: 'editor',
  disabled: false,
  mustChangePassword: false,
};
const author: AdminUser = {
  id: `special-pages-author-${runId}`,
  name: 'Special Pages Test Author',
  email: `special-pages-author-${runId}@example.test`,
  role: 'author',
  disabled: false,
  mustChangePassword: false,
};

let currentUser: AdminUser | null = null;

async function requireCurrentUser(): Promise<AdminUser> {
  if (!currentUser || currentUser.disabled) throw accessError('UNAUTHENTICATED');
  return currentUser;
}

async function requireCurrentRole(roles: AdminUser['role'][]): Promise<AdminUser> {
  const user = await requireCurrentUser();
  if (!roles.includes(user.role)) throw accessError('FORBIDDEN');
  return user;
}

async function requireCurrentMutationUser(roles?: AdminUser['role'][]): Promise<AdminUser> {
  const user = roles ? await requireCurrentRole(roles) : await requireCurrentUser();
  if (user.mustChangePassword) throw accessError('PASSWORD_CHANGE_REQUIRED');
  return user;
}

async function getCurrentSessionUser(): Promise<AdminUser | null> {
  return currentUser;
}

function body(text: string, image: boolean | string = false): RichNode {
  const imageUrl = typeof image === 'string' ? image : '/api/media/00000000-0000-4000-8000-000000000000';
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text,
            marks: [
              {
                type: 'link',
                attrs: {
                  href: 'https://example.test/read',
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  class: 'should-not-persist',
                  title: 'should-not-persist',
                },
              },
            ],
          },
        ],
      },
      ...(image
        ? [
            {
              type: 'image',
              attrs: {
                src: imageUrl,
                alt: null,
                title: null,
                width: null,
                height: null,
              },
            },
          ]
        : []),
    ],
  };
}

databaseDescribe('special pages database integration', () => {
  let controlSql: Sql | undefined;
  let testSql: Sql | undefined;
  let serviceSql: Sql | undefined;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;
  let specialPageActions: typeof import('@/lib/special-pages/actions');
  let specialPageStore: typeof import('@/lib/special-pages/store');
  let mediaService: typeof import('@/lib/cms/media');

  const requireTestDb = () => {
    if (!testDb) throw new Error('Test database is not initialized.');
    return testDb;
  };

  beforeAll(async () => {
    const source = sourceDatabaseUrl;
    if (!source) throw new Error('DATABASE_URL is required for special-page integration tests.');

    controlSql = postgres(databaseUrlFor(source, 'postgres'), { max: 1, prepare: false });
    await controlSql.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    const testDatabaseUrl = databaseUrlFor(source, testDatabaseName);
    testSql = postgres(testDatabaseUrl, { max: 10, prepare: false });
    testDb = drizzle({ client: testSql, schema });
    await migrate(testDb, { migrationsFolder: resolve(process.cwd(), 'drizzle') });

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.MEDIA_DIR = testMediaDirectory;
    vi.doMock('@/lib/auth/server', () => ({
      getSessionUser: getCurrentSessionUser,
      requireRole: requireCurrentRole,
      requireMutationUser: requireCurrentMutationUser,
    }));
    vi.resetModules();

    const [database, actionsModule, storeModule, mediaModule] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/special-pages/actions'),
      import('@/lib/special-pages/store'),
      import('@/lib/cms/media'),
    ]);
    serviceSql = database.sql;
    specialPageActions = actionsModule;
    specialPageStore = storeModule;
    mediaService = mediaModule;

    await requireTestDb().insert(schema.users).values([admin, editor, author]);
  });

  beforeEach(async () => {
    currentUser = admin;
    await requireTestDb().delete(schema.auditLog);
    await requireTestDb().delete(schema.settings).where(eq(schema.settings.key, SPECIAL_PAGE_SETTINGS_KEY));
  });

  afterAll(async () => {
    currentUser = null;
    if (serviceSql) await serviceSql.end({ timeout: 5 });
    if (testSql) await testSql.end({ timeout: 5 });
    if (controlSql) {
      await controlSql.unsafe(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
      await controlSql.end({ timeout: 5 });
    }
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalMediaDirectory === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = originalMediaDirectory;
    await rm(testMediaDirectory, { recursive: true, force: true });
    vi.doUnmock('@/lib/auth/server');
    vi.resetModules();
  });

  it('uses modest safe defaults until an editor explicitly publishes a page', async () => {
    const pages = await specialPageActions.getAdminSpecialPages();
    expect(pages.map((page) => page.key)).toEqual(['privacy', 'about']);
    expect(pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'privacy', version: 0, updatedAt: null, published: null, publishedAt: null }),
        expect.objectContaining({ key: 'about', version: 0, updatedAt: null, published: null, publishedAt: null }),
      ]),
    );

    const privacy = await specialPageStore.getPublicSpecialPage('privacy');
    const about = await specialPageStore.getPublicSpecialPage('about');
    expect(privacy).toMatchObject({ title: '隐私政策', publishedAt: null });
    expect(JSON.stringify(privacy.body)).toContain('订阅需要');
    expect(about).toMatchObject({ title: '关于 Darwin动漫社', intro: '用科学与人文创造幻想中的未来', publishedAt: null });
  });

  it('normalizes rich text, isolates drafts from visitors, and exposes media references by publication state', async () => {
    const saved = await specialPageActions.saveSpecialPage({
      key: 'about',
      expectedVersion: 0,
      intro: '  已清理的导语  ',
      body: body('仅管理员可见的草稿', true),
    });
    expect(saved).toMatchObject({ ok: true, data: { version: 1, draft: { intro: '已清理的导语' }, published: null } });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data.draft.body.content?.[0]?.content?.[0]?.marks).toEqual([
      { type: 'link', attrs: { href: 'https://example.test/read' } },
    ]);
    expect(saved.data.draft.body.content?.[1]).toEqual({
      type: 'image',
      attrs: { src: '/api/media/00000000-0000-4000-8000-000000000000' },
    });
    expect(JSON.stringify((await specialPageStore.getPublicSpecialPage('about')).body)).not.toContain('仅管理员可见的草稿');
    const beforePublishReferences = await specialPageStore.getSpecialPageMediaReferences();
    expect(beforePublishReferences.published).toEqual([]);
    expect(JSON.stringify(beforePublishReferences.all)).toContain('/api/media/00000000-0000-4000-8000-000000000000');

    const published = await specialPageActions.publishSpecialPage({ key: 'about', expectedVersion: saved.data.version });
    expect(published).toMatchObject({ ok: true, data: { version: 2, publishedAt: expect.any(String) } });
    if (!published.ok) throw new Error(published.error);
    expect(JSON.stringify((await specialPageStore.getPublicSpecialPage('about')).body)).toContain('仅管理员可见的草稿');
    const afterPublishReferences = await specialPageStore.getSpecialPageMediaReferences();
    expect(JSON.stringify(afterPublishReferences.published)).toContain('/api/media/00000000-0000-4000-8000-000000000000');

    const revised = await specialPageActions.saveSpecialPage({
      key: 'about',
      expectedVersion: published.data.version,
      intro: '下一版草稿',
      body: body('访客暂时不能看到的新草稿'),
    });
    expect(revised).toMatchObject({ ok: true, data: { version: 3, published: { intro: '已清理的导语' } } });
    expect(JSON.stringify((await specialPageStore.getPublicSpecialPage('about')).body)).not.toContain('访客暂时不能看到的新草稿');
  });

  it('keeps special-page media private until publication and protects media referenced by either snapshot', async () => {
    const mediaId = randomUUID();
    const storageKey = `${mediaId}.png`;
    const mediaUrl = `/api/media/${mediaId}`;
    const storedFile = resolve(testMediaDirectory, storageKey);
    await mkdir(testMediaDirectory, { recursive: true });
    await writeFile(storedFile, 'special-page-media');
    await requireTestDb().insert(schema.media).values({
      id: mediaId,
      ownerId: admin.id,
      filename: 'special-page.png',
      storageKey,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      size: 18,
      alt: '专页测试图片',
    });

    try {
      currentUser = null;
      expect(await mediaService.readMediaForRequest(mediaId)).toEqual({ ok: false, status: 401 });

      currentUser = admin;
      const saved = await specialPageActions.saveSpecialPage({
        key: 'about',
        expectedVersion: 0,
        intro: '带有私有草稿图片的专页',
        body: body('这张图片在发布前不能匿名读取。', mediaUrl),
      });
      expect(saved).toMatchObject({ ok: true, data: { version: 1 } });
      if (!saved.ok) throw new Error(saved.error);

      currentUser = null;
      expect(await mediaService.readMediaForRequest(mediaId)).toEqual({ ok: false, status: 401 });

      currentUser = admin;
      expect(await mediaService.deleteMedia(mediaId)).toMatchObject({ ok: false, code: 'REFERENCED' });
      const published = await specialPageActions.publishSpecialPage({ key: 'about', expectedVersion: saved.data.version });
      expect(published).toMatchObject({ ok: true, data: { version: 2 } });
      if (!published.ok) throw new Error(published.error);

      currentUser = null;
      expect(await mediaService.readMediaForRequest(mediaId)).toMatchObject({ ok: true, public: true, item: { id: mediaId } });

      currentUser = admin;
      const revisedDraft = await specialPageActions.saveSpecialPage({
        key: 'about',
        expectedVersion: published.data.version,
        intro: '图片只保留在已发布快照中',
        body: body('新的草稿不再引用这张图片。'),
      });
      expect(revisedDraft).toMatchObject({ ok: true, data: { version: 3 } });

      currentUser = null;
      expect(await mediaService.readMediaForRequest(mediaId)).toMatchObject({ ok: true, public: true, item: { id: mediaId } });

      currentUser = admin;
      expect(await mediaService.deleteMedia(mediaId)).toMatchObject({ ok: false, code: 'REFERENCED' });
    } finally {
      currentUser = admin;
      await requireTestDb().delete(schema.media).where(eq(schema.media.id, mediaId));
      await rm(storedFile, { force: true });
    }
  });

  it('rejects unsafe rich text and serializes simultaneous versions with a conflict result', async () => {
    const invalid = await specialPageActions.saveSpecialPage({
      key: 'privacy',
      expectedVersion: 0,
      intro: '不应保存',
      body: { type: 'doc', content: [{ type: 'rawHTML', html: '<script>alert(1)</script>' }] } as unknown as RichNode,
    });
    expect(invalid).toMatchObject({ ok: false, code: 'VALIDATION' });

    const initial = await specialPageActions.saveSpecialPage({
      key: 'privacy',
      expectedVersion: 0,
      intro: '初始草稿',
      body: body('初始内容'),
    });
    expect(initial.ok).toBe(true);
    if (!initial.ok) throw new Error(initial.error);

    const [first, second] = await Promise.all([
      specialPageActions.saveSpecialPage({
        key: 'privacy',
        expectedVersion: initial.data.version,
        intro: '并发更新 A',
        body: body('并发更新 A'),
      }),
      specialPageActions.saveSpecialPage({
        key: 'privacy',
        expectedVersion: initial.data.version,
        intro: '并发更新 B',
        body: body('并发更新 B'),
      }),
    ]);
    const successes = [first, second].filter((result) => result.ok);
    const conflicts = [first, second].filter((result) => !result.ok);
    expect(successes).toHaveLength(1);
    expect(conflicts).toEqual([expect.objectContaining({ code: 'CONFLICT' })]);
  });

  it('allows editors while preventing authors from reading or changing special-page drafts', async () => {
    currentUser = editor;
    const editorSave = await specialPageActions.saveSpecialPage({
      key: 'about',
      expectedVersion: 0,
      intro: '编辑可保存',
      body: body('编辑可保存的内容'),
    });
    expect(editorSave).toMatchObject({ ok: true, data: { version: 1 } });

    currentUser = author;
    await expect(specialPageActions.getAdminSpecialPages()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(specialPageActions.getAdminSpecialPage('about')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      specialPageActions.saveSpecialPage({ key: 'about', expectedVersion: 1, intro: '作者不可保存', body: body('作者不可保存') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(specialPageActions.publishSpecialPage({ key: 'about', expectedVersion: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
