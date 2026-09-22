import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SITE_ACCESS_KEY, normalizeSiteOrigin, validateSiteAccessConfig } from '@/lib/site-access/config';
import type { AdminUser } from '@/lib/cms/types';
import { ValidationError } from '@/lib/cms/validation';
import * as schema from '@/lib/db/schema';

const runId = randomUUID().replaceAll('-', '');
const testDatabaseName = `darwin_site_access_test_${runId}`;
const mutableEnvironment = process.env as Record<string, string | undefined>;
const originalEnvironment = {
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
  siteUrl: process.env.SITE_URL,
  betterAuthUrl: process.env.BETTER_AUTH_URL,
  nextPublicBetterAuthUrl: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
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
  id: `site-access-admin-${runId}`,
  name: 'Site Access Test Admin',
  email: `site-access-admin-${runId}@example.test`,
  role: 'admin',
  disabled: false,
  mustChangePassword: false,
};
const editor: AdminUser = {
  id: `site-access-editor-${runId}`,
  name: 'Site Access Test Editor',
  email: `site-access-editor-${runId}@example.test`,
  role: 'editor',
  disabled: false,
  mustChangePassword: false,
};
const author: AdminUser = {
  id: `site-access-author-${runId}`,
  name: 'Site Access Test Author',
  email: `site-access-author-${runId}@example.test`,
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

describe('site access origin validation', () => {
  it('normalizes bare domains, aliases, and the allowed development loopback origins', () => {
    expect(normalizeSiteOrigin('Journal.Example.test:443/', true)).toBe('https://journal.example.test');
    expect(normalizeSiteOrigin('http://localhost:3000/', false)).toBe('http://localhost:3000');
    expect(normalizeSiteOrigin('http://127.0.0.1:3000', false)).toBe('http://127.0.0.1:3000');
    expect(normalizeSiteOrigin('http://[::1]:3000', false)).toBe('http://[::1]:3000');
    expect(
      validateSiteAccessConfig(
        {
          publicUrl: 'https://journal.example.test/',
          trustedOrigins: ['HTTPS://OLD.EXAMPLE.TEST/', 'old.example.test'],
        },
        true,
      ),
    ).toEqual({ publicUrl: 'https://journal.example.test', trustedOrigins: ['https://old.example.test'] });
  });

  it('rejects paths before URL normalization and rejects malicious or incomplete inputs', () => {
    for (const input of [
      'https://journal.example.test/path/..',
      'https://journal.example.test/./',
      'https://journal.example.test/path',
      'https://journal.example.test?',
      'https://journal.example.test#',
      'https://journal.example.test\\path',
      'https://user:password@journal.example.test',
      'https://*.example.test',
      'https://journal$.example.test',
      'https://journal,example.test',
      'https://journal_example.test',
      'https://@journal.example.test',
      'ftp://journal.example.test',
      '//journal.example.test',
      'https://journal .example.test',
    ]) {
      expect(() => normalizeSiteOrigin(input, false)).toThrow(ValidationError);
    }
  });

  it('enforces production HTTPS and the alias count before duplicate collapsing', () => {
    expect(() => normalizeSiteOrigin('http://localhost:3000', true)).toThrow(ValidationError);
    expect(() => normalizeSiteOrigin('http://journal.example.test', false)).toThrow(ValidationError);
    expect(() =>
      validateSiteAccessConfig(
        { publicUrl: '', trustedOrigins: Array.from({ length: 11 }, () => 'https://same.example.test') },
        true,
      ),
    ).toThrow(ValidationError);
  });
});

databaseDescribe('site access database integration', () => {
  let controlSql: Sql | undefined;
  let testSql: Sql | undefined;
  let serviceSql: Sql | undefined;
  let databaseModule: typeof import('@/lib/db');
  let testDb: ReturnType<typeof drizzle<typeof schema>>;
  let accessActions: typeof import('@/lib/site-access/actions');
  let accessStore: typeof import('@/lib/site-access/store');

  const requireTestDb = () => {
    if (!testDb) throw new Error('Test database was not initialized.');
    return testDb;
  };

  function setDevelopmentEnvironment(): void {
    mutableEnvironment.NODE_ENV = 'development';
    process.env.SITE_URL = 'https://environment.example.test/';
    process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3000';
    delete process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
  }

  beforeAll(async () => {
    const source = sourceDatabaseUrl;
    if (!source) throw new Error('DATABASE_URL is required for site access integration tests.');

    controlSql = postgres(databaseUrlFor(source, 'postgres'), { max: 1, prepare: false });
    await controlSql.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    const testDatabaseUrl = databaseUrlFor(source, testDatabaseName);
    testSql = postgres(testDatabaseUrl, { max: 1, prepare: false });
    testDb = drizzle({ client: testSql, schema });
    await migrate(testDb, { migrationsFolder: resolve(process.cwd(), 'drizzle') });

    process.env.DATABASE_URL = testDatabaseUrl;
    setDevelopmentEnvironment();
    vi.doMock('@/lib/auth/server', () => ({
      requireRole: requireCurrentRole,
      requireMutationUser: requireCurrentMutationUser,
    }));
    vi.resetModules();

    const [database, actionsModule, storeModule] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/site-access/actions'),
      import('@/lib/site-access/store'),
    ]);
    serviceSql = database.sql;
    databaseModule = database;
    accessActions = actionsModule;
    accessStore = storeModule;

    await requireTestDb().insert(schema.users).values([
      { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      { id: editor.id, name: editor.name, email: editor.email, role: editor.role },
      { id: author.id, name: author.name, email: author.email, role: author.role },
    ]);
  });

  beforeEach(async () => {
    currentUser = admin;
    setDevelopmentEnvironment();
    await requireTestDb().delete(schema.auditLog);
    await requireTestDb().delete(schema.settings);
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
    if (originalEnvironment.nodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = originalEnvironment.nodeEnv;
    if (originalEnvironment.siteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = originalEnvironment.siteUrl;
    if (originalEnvironment.betterAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = originalEnvironment.betterAuthUrl;
    if (originalEnvironment.nextPublicBetterAuthUrl === undefined) delete process.env.NEXT_PUBLIC_BETTER_AUTH_URL;
    else process.env.NEXT_PUBLIC_BETTER_AUTH_URL = originalEnvironment.nextPublicBetterAuthUrl;
    vi.doUnmock('@/lib/auth/server');
    vi.resetModules();
  });

  it('reads additions, updates, and deletion dynamically without retaining a database cache', async () => {
    const first = { publicUrl: 'https://first.example.test', trustedOrigins: ['https://old.example.test'] };
    await requireTestDb().insert(schema.settings).values({ key: SITE_ACCESS_KEY, value: first });
    expect(await accessStore.readSiteAccessConfig()).toEqual(first);
    expect(await accessStore.getEffectivePublicUrl()).toBe('https://first.example.test');
    expect(await accessStore.getEffectiveTrustedOrigins('http://127.0.0.1:3000', false)).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
      'https://first.example.test',
      'https://old.example.test',
    ]);

    const second = { publicUrl: 'https://second.example.test', trustedOrigins: ['https://new.example.test'] };
    await requireTestDb()
      .update(schema.settings)
      .set({ value: second, updatedAt: new Date() })
      .where(eq(schema.settings.key, SITE_ACCESS_KEY));
    expect(await accessStore.readSiteAccessConfig()).toEqual(second);

    await requireTestDb().delete(schema.settings).where(eq(schema.settings.key, SITE_ACCESS_KEY));
    expect(await accessStore.readSiteAccessConfig()).toEqual({ publicUrl: '', trustedOrigins: [] });
    expect(await accessStore.getEffectivePublicUrl()).toBe('https://environment.example.test');
  });

  it('drops a malformed stored record as a whole and keeps production HTTP out of trusted origins', async () => {
    await requireTestDb().insert(schema.settings).values({
      key: SITE_ACCESS_KEY,
      value: { publicUrl: 'https://safe.example.test', trustedOrigins: ['http://unsafe.example.test'] },
    });
    mutableEnvironment.NODE_ENV = 'production';

    expect(await accessStore.readSiteAccessConfig()).toEqual({ publicUrl: '', trustedOrigins: [] });
    expect(await accessStore.getEffectiveTrustedOrigins('https://environment.example.test', true)).toEqual([
      'https://environment.example.test',
    ]);
  });

  it('saves an independent setting, preserves existing site settings, and records only public origins', async () => {
    const existingSiteSettings = { name: 'Existing site settings', privateMarker: 'must remain untouched' };
    await requireTestDb().insert(schema.settings).values({ key: 'site', value: existingSiteSettings });

    const saved = await accessActions.saveSiteAccess({
      publicUrl: 'journal.example.test/',
      trustedOrigins: ['https://old.example.test/', 'OLD.example.test'],
    });
    expect(saved).toMatchObject({
      ok: true,
      data: {
        config: { publicUrl: 'https://journal.example.test', trustedOrigins: ['https://old.example.test'] },
        publicUrl: 'https://journal.example.test',
        environmentOrigin: 'http://127.0.0.1:3000',
        production: false,
      },
    });

    const [siteRow] = await requireTestDb().select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, 'site'));
    const [accessRow] = await requireTestDb()
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, SITE_ACCESS_KEY));
    const [audit] = await requireTestDb()
      .select({ actorId: schema.auditLog.actorId, action: schema.auditLog.action, resourceId: schema.auditLog.resourceId, detail: schema.auditLog.detail })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'site_access.save'));

    expect(siteRow?.value).toEqual(existingSiteSettings);
    expect(accessRow?.value).toEqual({ publicUrl: 'https://journal.example.test', trustedOrigins: ['https://old.example.test'] });
    expect(audit).toEqual({
      actorId: admin.id,
      action: 'site_access.save',
      resourceId: SITE_ACCESS_KEY,
      detail: { publicUrl: 'https://journal.example.test', trustedOrigins: ['https://old.example.test'] },
    });
  });

  it('rejects HTTP saves in production', async () => {
    mutableEnvironment.NODE_ENV = 'production';
    const result = await accessActions.saveSiteAccess({ publicUrl: 'http://localhost:3000', trustedOrigins: [] });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await accessStore.readSiteAccessConfig()).toEqual({ publicUrl: '', trustedOrigins: [] });
  });

  it('requires a valid environment public URL in production when no canonical URL is stored', async () => {
    mutableEnvironment.NODE_ENV = 'production';
    delete process.env.SITE_URL;
    delete process.env.BETTER_AUTH_URL;

    await expect(accessStore.getEffectivePublicUrl()).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('does not turn a database query failure into an empty trusted-origin list', async () => {
    const databaseFailure = new Error('site-access test database failure');
    const select = vi.spyOn(databaseModule.db, 'select').mockImplementationOnce((() => {
      throw databaseFailure;
    }) as never);

    try {
      await expect(accessStore.readSiteAccessConfig()).rejects.toBe(databaseFailure);
    } finally {
      select.mockRestore();
    }
  });

  it('does not let editors or authors view or save site-access configuration', async () => {
    for (const user of [editor, author]) {
      currentUser = user;
      await expect(accessActions.getAdminSiteAccess()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        accessActions.saveSiteAccess({ publicUrl: 'https://journal.example.test', trustedOrigins: [] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(await requireTestDb().select({ id: schema.auditLog.id }).from(schema.auditLog)).toEqual([]);
  });
});
