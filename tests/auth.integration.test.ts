import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AdminUser, UserInput } from '@/lib/cms/types';
import * as schema from '@/lib/db/schema';

// Vitest resolves the marker package through Node's default condition even though the source
// module is server-only. The app build resolves it through the react-server condition.
vi.mock('server-only', () => ({}));

const baseUrl = 'http://127.0.0.1:3000';
const testSecret = 'auth-integration-test-secret-that-is-longer-than-thirty-two-characters';
const runId = randomUUID().replaceAll('-', '');
const testDatabaseName = `darwin_auth_test_${runId}`;
const originalEnvironment = {
  databaseUrl: process.env.DATABASE_URL,
  betterAuthSecret: process.env.BETTER_AUTH_SECRET,
  betterAuthUrl: process.env.BETTER_AUTH_URL,
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

function testUser(input: {
  id?: string;
  name: string;
  email: string;
  role: AdminUser['role'];
  disabled?: boolean;
  mustChangePassword?: boolean;
}): AdminUser {
  return {
    id: input.id ?? `auth-test-${randomUUID()}`,
    name: input.name,
    email: input.email,
    role: input.role,
    disabled: input.disabled ?? false,
    mustChangePassword: input.mustChangePassword ?? false,
  };
}

function userInput(user: AdminUser, overrides: Partial<UserInput> = {}): UserInput {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    ...overrides,
  };
}

function errorWithCode(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

databaseDescribe('authentication database integration', () => {
  let controlSql: Sql | undefined;
  let testSql: Sql | undefined;
  let serviceSql: Sql | undefined;
  let routeSql: Sql | undefined;
  let testDatabaseUrl = '';
  let testDb: ReturnType<typeof drizzle<typeof schema>>;
  let testAuth: ReturnType<typeof betterAuth>;
  let usersService: typeof import('@/lib/cms/users');
  let currentIdentity: AdminUser | null = null;
  let requestHeaders = new Headers();
  let primaryAdmin: AdminUser;

  const rawUsers: AdminUser[] = [];

  const requireTestDb = () => {
    if (!testDb) throw new Error('Test database was not initialized.');
    return testDb;
  };

  const requireAuth = () => {
    if (!testAuth) throw new Error('Test auth instance was not initialized.');
    return testAuth;
  };

  async function createRawUser(input: Omit<AdminUser, 'id'> & { password: string; id?: string }): Promise<AdminUser> {
    const user = testUser(input);
    const database = requireTestDb();
    await database.insert(schema.users).values({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: true,
      role: user.role,
      disabled: user.disabled,
      mustChangePassword: user.mustChangePassword,
    });
    await database.insert(schema.accounts).values({
      id: `credential-${randomUUID()}`,
      accountId: user.id,
      providerId: 'credential',
      userId: user.id,
      password: await hashPassword(input.password),
    });
    rawUsers.push(user);
    return user;
  }

  async function sendAuthRequest(
    path: string,
    body: Record<string, unknown>,
    ipAddress = '198.51.100.10',
  ): Promise<Response> {
    return requireAuth().handler(
      new Request(`${baseUrl}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          'x-forwarded-for': ipAddress,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  function sessionCookie(response: Response): string {
    const cookieHeaders = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [
      response.headers.get('set-cookie') ?? '',
    ];
    const session = cookieHeaders.find((value) => value.startsWith('darwin-auth-test.session_token='));
    if (!session) throw new Error('Expected Better Auth to set a session cookie.');
    return session.split(';', 1)[0]!;
  }

  async function signIn(email: string, password: string, ipAddress: string): Promise<{ response: Response; cookie: string }> {
    const response = await sendAuthRequest('/sign-in/email', { email, password }, ipAddress);
    expect(response.status).toBe(200);
    return { response, cookie: sessionCookie(response) };
  }

  async function sessionFor(cookie: string) {
    return requireAuth().api.getSession({ headers: new Headers({ cookie }) });
  }

  async function loadUsersService(): Promise<void> {
    vi.resetModules();
    vi.doMock('@/lib/auth/server', () => ({
      getAuth: () => ({
        api: {
          changePassword: (input: unknown) =>
            (requireAuth().api.changePassword as (value: unknown) => Promise<unknown>)(input),
        },
      }),
      requireUser: async () => {
        if (!currentIdentity || currentIdentity.disabled) throw errorWithCode('UNAUTHENTICATED');
        return currentIdentity;
      },
      requireRole: async (roles: AdminUser['role'][]) => {
        if (!currentIdentity || currentIdentity.disabled) throw errorWithCode('UNAUTHENTICATED');
        if (!roles.includes(currentIdentity.role)) throw errorWithCode('FORBIDDEN');
        return currentIdentity;
      },
      requireMutationUser: async (roles?: AdminUser['role'][]) => {
        if (!currentIdentity || currentIdentity.disabled) throw errorWithCode('UNAUTHENTICATED');
        if (roles && !roles.includes(currentIdentity.role)) throw errorWithCode('FORBIDDEN');
        if (currentIdentity.mustChangePassword) throw errorWithCode('PASSWORD_CHANGE_REQUIRED');
        return currentIdentity;
      },
    }));
    vi.doMock('next/headers', () => ({ headers: async () => requestHeaders }));

    usersService = await import('@/lib/cms/users');
    serviceSql = (await import('@/lib/db')).sql;
  }

  beforeAll(async () => {
    const source = sourceDatabaseUrl;
    if (!source) throw new Error('DATABASE_URL is required for authentication integration tests.');

    controlSql = postgres(databaseUrlFor(source, 'postgres'), { max: 1, prepare: false });
    await controlSql.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    testDatabaseUrl = databaseUrlFor(source, testDatabaseName);
    testSql = postgres(testDatabaseUrl, { max: 1, prepare: false });
    testDb = drizzle({ client: testSql, schema });
    await migrate(testDb, { migrationsFolder: resolve(process.cwd(), 'drizzle') });

    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.BETTER_AUTH_SECRET = testSecret;
    process.env.BETTER_AUTH_URL = baseUrl;
    testAuth = betterAuth({
      appName: 'Darwin auth integration',
      baseURL: baseUrl,
      secret: testSecret,
      database: drizzleAdapter(testDb, {
        provider: 'pg',
        schema: {
          user: schema.users,
          session: schema.sessions,
          account: schema.accounts,
          verification: schema.verifications,
          rateLimit: schema.rateLimits,
        },
        transaction: true,
      }),
      emailAndPassword: {
        enabled: true,
        disableSignUp: true,
        minPasswordLength: 12,
        maxPasswordLength: 128,
        revokeSessionsOnPasswordReset: true,
      },
      user: {
        additionalFields: {
          role: { type: 'string', required: true, defaultValue: 'author', input: false },
          disabled: { type: 'boolean', required: true, defaultValue: false, input: false },
          mustChangePassword: { type: 'boolean', required: true, defaultValue: false, input: false },
        },
      },
      session: { cookieCache: { enabled: false } },
      advanced: {
        cookiePrefix: 'darwin-auth-test',
        useSecureCookies: false,
        defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: false, path: '/' },
      },
      rateLimit: { enabled: true, storage: 'database' },
      disabledPaths: ['/sign-up/email', '/request-password-reset', '/reset-password'],
      databaseHooks: {
        session: {
          create: {
            before: async (session) => {
              const [user] = await testDb
                .select({ disabled: schema.users.disabled })
                .from(schema.users)
                .where(eq(schema.users.id, session.userId))
                .limit(1);
              return Boolean(user && !user.disabled);
            },
          },
        },
      },
    }) as unknown as ReturnType<typeof betterAuth>;
    await testAuth.$context;

    primaryAdmin = await createRawUser({
      name: 'Primary Test Admin',
      email: `auth-admin-${runId}@example.test`,
      role: 'admin',
      disabled: false,
      mustChangePassword: false,
      password: 'PrimaryAdminPassword-123',
    });
    currentIdentity = primaryAdmin;
    await loadUsersService();
  });

  afterAll(async () => {
    if (routeSql) await routeSql.end({ timeout: 5 });
    if (serviceSql) await serviceSql.end({ timeout: 5 });
    if (testSql) await testSql.end({ timeout: 5 });
    if (controlSql) {
      await controlSql.unsafe(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
      await controlSql.end({ timeout: 5 });
    }

    if (originalEnvironment.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalEnvironment.databaseUrl;
    if (originalEnvironment.betterAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalEnvironment.betterAuthSecret;
    if (originalEnvironment.betterAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = originalEnvironment.betterAuthUrl;
  });

  it('closes public registration and persists shared login rate limits', async () => {
    const registrationEmail = `auth-public-registration-${runId}@example.test`;
    const registration = await sendAuthRequest(
      '/sign-up/email',
      { name: 'Public Registration', email: registrationEmail, password: 'PublicPassword-123' },
      '198.51.100.21',
    );
    expect(registration.ok).toBe(false);
    expect(
      await requireTestDb().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, registrationEmail)),
    ).toEqual([]);

    const rateLimitIp = '198.51.100.22';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await sendAuthRequest(
        '/sign-in/email',
        { email: `rate-limit-${runId}@example.test`, password: 'IncorrectPassword-123' },
        rateLimitIp,
      );
      expect(response.status).toBe(401);
    }
    const blocked = await sendAuthRequest(
      '/sign-in/email',
      { email: `rate-limit-${runId}@example.test`, password: 'IncorrectPassword-123' },
      rateLimitIp,
    );
    expect(blocked.status).toBe(429);
    expect((await requireTestDb().select().from(schema.rateLimits)).length).toBeGreaterThan(0);
  });

  it('creates managed accounts with a required password change and blocks unauthorized mutations', async () => {
    currentIdentity = primaryAdmin;
    const created = await usersService.saveUser({
      name: 'Managed Author',
      email: `auth-managed-author-${runId}@example.test`,
      role: 'author',
      disabled: false,
      password: 'ManagedAuthorPassword-123',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    const [stored] = await requireTestDb().select().from(schema.users).where(eq(schema.users.id, created.data.id)).limit(1);
    expect(stored?.mustChangePassword).toBe(true);

    currentIdentity = { ...primaryAdmin, mustChangePassword: true };
    await expect(
      usersService.saveUser({
        name: 'Blocked By Password Policy',
        email: `auth-blocked-${runId}@example.test`,
        role: 'author',
        password: 'BlockedPassword-123',
      }),
    ).rejects.toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });

    currentIdentity = { ...created.data, mustChangePassword: false };
    await expect(usersService.getUsers()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      usersService.saveUser({
        name: 'Blocked By Role',
        email: `auth-role-blocked-${runId}@example.test`,
        role: 'author',
        password: 'BlockedRolePassword-123',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('invalidates old sessions after an administrator reset or account disable', async () => {
    const securityUser = await createRawUser({
      name: 'Security Test User',
      email: `auth-security-${runId}@example.test`,
      role: 'author',
      disabled: false,
      mustChangePassword: false,
      password: 'SecurityOriginalPassword-123',
    });
    const oldSession = await signIn(securityUser.email, 'SecurityOriginalPassword-123', '198.51.100.31');
    expect(await sessionFor(oldSession.cookie)).not.toBeNull();

    currentIdentity = primaryAdmin;
    const reset = await usersService.resetUserPassword(securityUser.id, 'SecurityResetPassword-456');
    expect(reset.ok).toBe(true);
    expect(await sessionFor(oldSession.cookie)).toBeNull();
    const [resetStored] = await requireTestDb().select().from(schema.users).where(eq(schema.users.id, securityUser.id)).limit(1);
    expect(resetStored?.mustChangePassword).toBe(true);

    const replacementSession = await signIn(securityUser.email, 'SecurityResetPassword-456', '198.51.100.32');
    const disabled = await usersService.saveUser(userInput({ ...securityUser, mustChangePassword: true }, { disabled: true }));
    expect(disabled.ok).toBe(true);
    expect(await sessionFor(replacementSession.cookie)).toBeNull();
    const disabledSignIn = await sendAuthRequest(
      '/sign-in/email',
      { email: securityUser.email, password: 'SecurityResetPassword-456' },
      '198.51.100.33',
    );
    expect(disabledSignIn.ok).toBe(false);
    expect(
      await requireTestDb().select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, securityUser.id)),
    ).toEqual([]);
  });

  it('allows a forced user to change their own password, then revokes every prior session', async () => {
    const forcedUser = await createRawUser({
      name: 'Forced Password User',
      email: `auth-forced-${runId}@example.test`,
      role: 'author',
      disabled: false,
      mustChangePassword: true,
      password: 'ForcedOriginalPassword-123',
    });
    const oldSession = await signIn(forcedUser.email, 'ForcedOriginalPassword-123', '198.51.100.41');
    currentIdentity = forcedUser;
    requestHeaders = new Headers({ cookie: oldSession.cookie });

    const changed = await usersService.changeOwnPassword('ForcedOriginalPassword-123', 'ForcedChangedPassword-456');
    expect(changed.ok).toBe(true);
    expect(await sessionFor(oldSession.cookie)).toBeNull();
    const [stored] = await requireTestDb().select().from(schema.users).where(eq(schema.users.id, forcedUser.id)).limit(1);
    expect(stored?.mustChangePassword).toBe(false);
    const renewed = await signIn(forcedUser.email, 'ForcedChangedPassword-456', '198.51.100.42');
    expect(await sessionFor(renewed.cookie)).not.toBeNull();
  });

  it('serializes concurrent final-administrator demotions and refuses the last disable', async () => {
    currentIdentity = primaryAdmin;
    const secondAdminResult = await usersService.saveUser({
      name: 'Second Test Admin',
      email: `auth-second-admin-${runId}@example.test`,
      role: 'admin',
      disabled: false,
      password: 'SecondAdminPassword-123',
    });
    expect(secondAdminResult.ok).toBe(true);
    if (!secondAdminResult.ok) throw new Error(secondAdminResult.error);
    const secondAdmin = secondAdminResult.data;

    const concurrent = await Promise.all([
      usersService.saveUser(userInput(primaryAdmin, { role: 'author' })),
      usersService.saveUser(userInput(secondAdmin, { role: 'author' })),
    ]);
    expect(concurrent.filter((result) => result.ok)).toHaveLength(1);
    expect(concurrent.find((result) => !result.ok)).toMatchObject({ code: 'LAST_ADMIN' });

    const activeAdmins = await requireTestDb()
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.role, 'admin'), eq(schema.users.disabled, false)));
    expect(activeAdmins).toHaveLength(1);
    const finalAdmin = activeAdmins[0]!;
    currentIdentity = testUser({
      id: finalAdmin.id,
      name: finalAdmin.name,
      email: finalAdmin.email,
      role: finalAdmin.role,
      disabled: finalAdmin.disabled,
      mustChangePassword: false,
    });
    await requireTestDb()
      .update(schema.users)
      .set({ mustChangePassword: false })
      .where(eq(schema.users.id, finalAdmin.id));

    const lastDisable = await usersService.saveUser(userInput(currentIdentity, { disabled: true }));
    expect(lastDisable).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
  });

  it('returns no API session for a disabled account and expires its cookie', async () => {
    // The user service above deliberately mocks auth to exercise its own authorization boundary.
    // Reset that mock here so this test covers the production route and session guard together.
    vi.doUnmock('@/lib/auth/server');
    vi.resetModules();

    const route = await import('@/app/api/auth/[...all]/route');
    routeSql = (await import('@/lib/db')).sql;
    const routeUser = await createRawUser({
      name: 'Route Session Guard User',
      email: `auth-route-guard-${runId}@example.test`,
      role: 'author',
      disabled: false,
      mustChangePassword: false,
      password: 'RouteSessionPassword-123',
    });

    const signInResponse = await route.POST(
      new Request(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ email: routeUser.email, password: 'RouteSessionPassword-123' }),
      }),
    );
    expect(signInResponse.status).toBe(200);
    const cookieHeaders = (signInResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [
      signInResponse.headers.get('set-cookie') ?? '',
    ];
    const cookie = cookieHeaders.find((value) => value.startsWith('darwin.session_token='))?.split(';', 1)[0];
    expect(cookie).toBeTruthy();

    await requireTestDb().update(schema.users).set({ disabled: true }).where(eq(schema.users.id, routeUser.id));
    const sessionResponse = await route.GET(
      new Request(`${baseUrl}/api/auth/get-session`, { headers: { cookie: cookie! } }),
    );

    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toBeNull();
    expect(
      await requireTestDb().select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.userId, routeUser.id)),
    ).toEqual([]);
    const expiryCookies = (sessionResponse.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [
      sessionResponse.headers.get('set-cookie') ?? '',
    ];
    expect(expiryCookies.some((value) => value.startsWith('darwin.session_token=') && /max-age=0/i.test(value))).toBe(true);
  });

  it('applies saved domain additions and removals to an already initialized HTTP auth handler', async () => {
    if (routeSql) await routeSql.end({ timeout: 5 });
    vi.doUnmock('@/lib/auth/server');
    vi.resetModules();

    const publicOrigin = 'https://journal-domain-test.example';
    const aliasOrigin = 'https://alias-domain-test.example';
    const key = 'site_access';
    const setOrigins = async (publicUrl: string, trustedOrigins: string[]) => {
      const value = { publicUrl, trustedOrigins };
      await requireTestDb().insert(schema.settings).values({ key, value })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
    };
    // Populate before first auth initialization, so removal must not leave startup aliases in
    // Better Auth's long-lived context. No application restart occurs in this test.
    await setOrigins(publicOrigin, [aliasOrigin]);
    const route = await import('@/app/api/auth/[...all]/route');
    routeSql = (await import('@/lib/db')).sql;
    const domainUser = await createRawUser({
      name: 'Domain Configuration Test User', email: `auth-domain-${runId}@example.test`,
      role: 'admin', disabled: false, mustChangePassword: false,
      password: 'DomainConfigurationPassword-123',
    });
    const login = (origin: string) => route.POST(new Request(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ email: domainUser.email, password: 'DomainConfigurationPassword-123' }),
    }));
    try {
      expect((await login(aliasOrigin)).status).toBe(200);
      await setOrigins(publicOrigin, []);
      const removedAlias = await login(aliasOrigin);
      expect(removedAlias.status).toBe(403);
      expect(await removedAlias.json()).toMatchObject({ code: 'INVALID_ORIGIN' });
      expect((await login(publicOrigin)).status).toBe(200);
      await setOrigins('', []);
      expect((await login(publicOrigin)).status).toBe(403);
      expect((await login(baseUrl)).status).toBe(200);
      expect((await login('https://forged-host.example')).status).toBe(403);
      await setOrigins('', [aliasOrigin]);
      expect((await login(aliasOrigin)).status).toBe(200);
    } finally {
      await requireTestDb().delete(schema.settings).where(eq(schema.settings.key, key));
    }
  });

  it('defers missing database and secret configuration until an authentication request', async () => {
    const runtimeEnvironment = {
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL,
      betterAuthSecret: process.env.BETTER_AUTH_SECRET,
      authSecret: process.env.AUTH_SECRET,
      betterAuthUrl: process.env.BETTER_AUTH_URL,
      siteUrl: process.env.SITE_URL,
    };

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.DATABASE_URL = '';
      delete process.env.BETTER_AUTH_SECRET;
      delete process.env.AUTH_SECRET;
      delete process.env.BETTER_AUTH_URL;
      delete process.env.SITE_URL;
      vi.resetModules();

      const authServer = await import('@/lib/auth/server');
      const database = await import('@/lib/db');
      expect(authServer.getAuth).toBeTypeOf('function');
      expect(() => database.assertDatabaseConfigured()).toThrow('DATABASE_URL is not configured');
      expect(() => authServer.assertAuthConfigured()).toThrow('BETTER_AUTH_SECRET must be a random value');
      expect(() => authServer.getAuth()).toThrow('DATABASE_URL is not configured');
      await database.sql.end({ timeout: 5 });
    } finally {
      if (runtimeEnvironment.nodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string | undefined>).NODE_ENV = runtimeEnvironment.nodeEnv;
      if (runtimeEnvironment.databaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = runtimeEnvironment.databaseUrl;
      if (runtimeEnvironment.betterAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = runtimeEnvironment.betterAuthSecret;
      if (runtimeEnvironment.authSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = runtimeEnvironment.authSecret;
      if (runtimeEnvironment.betterAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = runtimeEnvironment.betterAuthUrl;
      if (runtimeEnvironment.siteUrl === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = runtimeEnvironment.siteUrl;
      vi.resetModules();
    }
  });
});
