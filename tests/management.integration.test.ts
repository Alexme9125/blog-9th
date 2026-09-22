import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NavigationItem, PageBlock, SiteSettings } from '@/lib/content/types';
import type { AdminUser, DocumentData } from '@/lib/cms/types';
import * as schema from '@/lib/db/schema';

const runId = randomUUID().replaceAll('-', '');
const testDatabaseName = `darwin_management_test_${runId}`;
const originalEnvironment = {
  databaseUrl: process.env.DATABASE_URL,
};

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
  id: `management-admin-${runId}`,
  name: 'Management Test Admin',
  email: `management-admin-${runId}@example.test`,
  role: 'admin',
  disabled: false,
  mustChangePassword: false,
};
const editor: AdminUser = {
  id: `management-editor-${runId}`,
  name: 'Management Test Editor',
  email: `management-editor-${runId}@example.test`,
  role: 'editor',
  disabled: false,
  mustChangePassword: false,
};
const author: AdminUser = {
  id: `management-author-${runId}`,
  name: 'Management Test Author',
  email: `management-author-${runId}@example.test`,
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

function baseNavigation(): NavigationItem[] {
  return [
    { id: 'home', label: '首页', href: '/', visible: true, order: 0, fixed: true },
    { id: 'journal', label: '社团刊物', href: '/search', visible: true, order: 1 },
    { id: 'members', label: '主要成员', href: '/members', visible: true, order: 2, fixed: true },
  ];
}

function settingsInput(navigation = baseNavigation()): SiteSettings {
  return {
    name: `Management Test ${runId}`,
    slogan: '管理服务端验收',
    description: '验证导航、成员和权限边界。',
    footer: 'Management integration test',
    membersIntro: '成员介绍。',
    navigation,
  };
}

function richBody(text: string): DocumentData['body'] {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function pageData(input: { slug: string; title: string; blocks: PageBlock[] }): DocumentData {
  return {
    slug: input.slug,
    title: input.title,
    excerpt: `${input.title} 摘要`,
    coverUrl: null,
    coverAlt: '',
    categoryId: null,
    tagIds: [],
    body: richBody(`${input.title} 正文`),
    blocks: input.blocks,
    description: `${input.title} 描述`,
    featured: false,
  };
}

databaseDescribe('management service database integration', () => {
  let controlSql: Sql | undefined;
  let testSql: Sql | undefined;
  let serviceSql: Sql | undefined;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;
  let documentsService: typeof import('@/lib/cms/documents');
  let membersService: typeof import('@/lib/cms/members');
  let settingsService: typeof import('@/lib/cms/settings');
  let publicContent: typeof import('@/lib/content/public');

  const requireTestDb = () => {
    if (!testDb) throw new Error('Test database was not initialized.');
    return testDb;
  };

  beforeEach(() => {
    currentUser = admin;
  });

  beforeAll(async () => {
    const source = sourceDatabaseUrl;
    if (!source) throw new Error('DATABASE_URL is required for management integration tests.');

    controlSql = postgres(databaseUrlFor(source, 'postgres'), { max: 1, prepare: false });
    await controlSql.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    const testDatabaseUrl = databaseUrlFor(source, testDatabaseName);
    testSql = postgres(testDatabaseUrl, { max: 1, prepare: false });
    testDb = drizzle({ client: testSql, schema });
    await migrate(testDb, { migrationsFolder: resolve(process.cwd(), 'drizzle') });

    process.env.DATABASE_URL = testDatabaseUrl;
    vi.doMock('@/lib/auth/server', () => ({
      getSessionUser: async () => currentUser,
      requireUser: requireCurrentUser,
      requireRole: requireCurrentRole,
      requireMutationUser: requireCurrentMutationUser,
    }));
    vi.resetModules();

    const [database, documentsModule, membersModule, settingsModule, publicModule] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/cms/documents'),
      import('@/lib/cms/members'),
      import('@/lib/cms/settings'),
      import('@/lib/content/public'),
    ]);
    serviceSql = database.sql;
    documentsService = documentsModule;
    membersService = membersModule;
    settingsService = settingsModule;
    publicContent = publicModule;

    await requireTestDb().insert(schema.users).values([
      { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      { id: editor.id, name: editor.name, email: editor.email, role: editor.role },
      { id: author.id, name: author.name, email: author.email, role: author.role },
    ]);
  });

  afterAll(async () => {
    currentUser = null;
    if (serviceSql) await serviceSql.end({ timeout: 5 });
    if (testSql) await testSql.end({ timeout: 5 });
    if (controlSql) {
      await controlSql.unsafe(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
      await controlSql.end({ timeout: 5 });
    }
    if (originalEnvironment.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalEnvironment.databaseUrl;
    vi.doUnmock('@/lib/auth/server');
    vi.resetModules();
  });

  it('protects fixed navigation and validates custom navigation URLs', async () => {
    const validNavigation = [
      ...baseNavigation(),
      { id: 'resources', label: '社团资源', href: 'https://resources.example.test/guide', visible: true, order: 3 },
    ];
    const saved = await settingsService.saveSettings(settingsInput(validNavigation));
    expect(saved).toMatchObject({ ok: true, data: { navigation: validNavigation } });
    expect((await publicContent.getSiteSettings()).navigation).toEqual(validNavigation);

    const mutations: NavigationItem[][] = [
      validNavigation.filter((item) => item.id !== 'home'),
      validNavigation.map((item) => (item.id === 'home' ? { ...item, visible: false } : item)),
      validNavigation.map((item) => (item.id === 'members' ? { ...item, href: '/people' } : item)),
      validNavigation.map((item) => (item.id === 'resources' ? { ...item, href: 'javascript:alert(1)' } : item)),
      validNavigation.map((item) => (item.id === 'resources' ? { ...item, href: '//untrusted.example.test' } : item)),
      validNavigation.map((item) => (item.id === 'resources' ? { ...item, href: '/safe/../escape' } : item)),
    ];

    for (const navigation of mutations) {
      const result = await settingsService.saveSettings(settingsInput(navigation));
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    }
    expect((await publicContent.getSiteSettings()).navigation).toEqual(validNavigation);
  });

  it('persists, reorders, and deletes member profiles without touching login accounts', async () => {
    const initialUsers = await requireTestDb().select({ id: schema.users.id }).from(schema.users);

    const first = await membersService.saveMember({
      name: 'Later Profile',
      role: 'Community member',
      bio: 'Created independently of any login account.',
      avatarUrl: null,
      interests: ['writing'],
      links: [{ label: 'Website', url: 'https://members.example.test/later' }],
      order: 20,
    });
    const second = await membersService.saveMember({
      name: 'Earlier Profile',
      role: 'Community member',
      bio: 'A separate public profile.',
      avatarUrl: null,
      interests: ['illustration'],
      links: [],
      order: 10,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Could not create member test profiles.');

    expect((await membersService.getAdminMembers()).map((member) => member.id)).toEqual([second.data.id, first.data.id]);

    const reordered = await membersService.saveMember({
      ...first.data,
      name: 'Reordered Profile',
      role: 'Editor profile only',
      order: 0,
    });
    expect(reordered).toMatchObject({ ok: true, data: { id: first.data.id, name: 'Reordered Profile', order: 0 } });
    expect((await publicContent.getMembers()).map((member) => member.id)).toEqual([first.data.id, second.data.id]);

    const deleted = await membersService.deleteMember(second.data.id);
    expect(deleted).toMatchObject({ ok: true });
    expect((await publicContent.getMembers()).map((member) => member.id)).toEqual([first.data.id]);
    expect(await requireTestDb().select({ id: schema.users.id }).from(schema.users)).toEqual(initialUsers);
  });

  it('does not let an author manage pages, members, or site settings', async () => {
    currentUser = author;
    const page = await documentsService.saveDocument({
      kind: 'page',
      data: pageData({
        slug: `author-blocked-page-${runId}`,
        title: 'Author blocked page',
        blocks: [],
      }),
    });
    expect(page).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    await expect(membersService.getAdminMembers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      membersService.saveMember({
        name: 'Blocked Member',
        role: 'Blocked',
        bio: 'An author cannot create a public member profile.',
        avatarUrl: null,
        interests: [],
        links: [],
        order: 30,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(settingsService.getAdminSettings()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(settingsService.saveSettings(settingsInput())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(settingsService.saveMembersIntro('An author cannot change this.')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('preserves an unreviewed page module order while retaining its prior public snapshot', async () => {
    const initialBlocks: PageBlock[] = [
      { id: 'intro-module', type: 'richtext', title: 'Introduction', body: richBody('Initial introduction.') },
      {
        id: 'links-module',
        type: 'links',
        title: 'Links',
        links: [{ label: 'Reference', url: 'https://pages.example.test/reference', description: 'Initial reference.' }],
      },
      { id: 'members-module', type: 'members', title: 'Members', memberIds: [] },
    ];
    const initialSlug = `module-order-${runId}`;
    const created = await documentsService.saveDocument({
      kind: 'page',
      data: pageData({ slug: initialSlug, title: 'Published module order', blocks: initialBlocks }),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const published = await documentsService.transitionDocument({ id: created.data.id, expectedVersion: created.data.version, action: 'publish' });
    expect(published.ok).toBe(true);
    if (!published.ok || !published.data) throw new Error('Could not publish module-order page.');
    expect((await publicContent.getPublicPage(initialSlug))?.blocks.map((block) => block.id)).toEqual(
      initialBlocks.map((block) => block.id),
    );

    const revisedBlocks: PageBlock[] = [initialBlocks[2]!, initialBlocks[0]!, initialBlocks[1]!];
    const draftSlug = `${initialSlug}-draft`;
    const revised = await documentsService.saveDocument({
      id: created.data.id,
      kind: 'page',
      expectedVersion: published.data.version,
      data: pageData({ slug: draftSlug, title: 'Unreviewed module order', blocks: revisedBlocks }),
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) throw new Error(revised.error);
    const submitted = await documentsService.transitionDocument({ id: created.data.id, expectedVersion: revised.data.version, action: 'submit' });
    expect(submitted).toMatchObject({ ok: true, data: { status: 'review' } });

    const adminDocument = await documentsService.getAdminDocument(created.data.id);
    expect(adminDocument).toMatchObject({ status: 'review', draft: { slug: draftSlug, blocks: revisedBlocks } });
    expect((await publicContent.getPublicPage(initialSlug))?.blocks.map((block) => block.id)).toEqual(
      initialBlocks.map((block) => block.id),
    );
    expect((await publicContent.getPublicPage(initialSlug))?.title).toBe('Published module order');
    expect(await publicContent.getPublicPage(draftSlug)).toBeNull();
  });
});
