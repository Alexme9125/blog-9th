import process from 'node:process';

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

type RuntimeEnvironment = {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
  betterAuthSecret: string | undefined;
  authSecret: string | undefined;
  betterAuthUrl: string | undefined;
  siteUrl: string | undefined;
};

function captureEnvironment(): RuntimeEnvironment {
  return {
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    betterAuthSecret: process.env.BETTER_AUTH_SECRET,
    authSecret: process.env.AUTH_SECRET,
    betterAuthUrl: process.env.BETTER_AUTH_URL,
    siteUrl: process.env.SITE_URL,
  };
}

function restoreEnvironment(environment: RuntimeEnvironment): void {
  const target = process.env as Record<string, string | undefined>;
  if (environment.nodeEnv === undefined) delete target.NODE_ENV;
  else target.NODE_ENV = environment.nodeEnv;
  if (environment.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = environment.databaseUrl;
  if (environment.betterAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = environment.betterAuthSecret;
  if (environment.authSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = environment.authSecret;
  if (environment.betterAuthUrl === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = environment.betterAuthUrl;
  if (environment.siteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = environment.siteUrl;
}

function configureProductionEnvironment(values: {
  databaseUrl: string;
  betterAuthUrl: string;
  secret?: string;
}): void {
  const target = process.env as Record<string, string | undefined>;
  target.NODE_ENV = 'production';
  process.env.DATABASE_URL = values.databaseUrl;
  if (values.secret) process.env.BETTER_AUTH_SECRET = values.secret;
  else delete process.env.BETTER_AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  process.env.BETTER_AUTH_URL = values.betterAuthUrl;
  process.env.SITE_URL = values.betterAuthUrl;
}

describe('production authentication configuration', () => {
  it.each(['https://*.example.test', 'https://user:password@example.test', 'https://example.test/path/..', 'https://example.test?'])('rejects an unsafe environment authentication URL: %s', async (betterAuthUrl) => {
    const environment = captureEnvironment();
    let sql: Sql | undefined;
    try {
      configureProductionEnvironment({
        databaseUrl: '', betterAuthUrl,
        secret: 'production-auth-test-secret-that-is-longer-than-thirty-two-characters',
      });
      vi.resetModules();
      const authServer = await import('@/lib/auth/server');
      sql = (await import('@/lib/db')).sql;
      expect(() => authServer.assertAuthConfigured()).toThrow('BETTER_AUTH_URL must be an exact HTTP(S) origin');
    } finally {
      if (sql) await sql.end({ timeout: 5 });
      restoreEnvironment(environment);
      vi.resetModules();
    }
  });

  it('rejects a second implicit origin allow-list before authentication starts', async () => {
    const environment = captureEnvironment();
    const legacyOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    let sql: Sql | undefined;
    try {
      configureProductionEnvironment({
        databaseUrl: '', betterAuthUrl: 'https://darwin.example.test',
        secret: 'production-auth-test-secret-that-is-longer-than-thirty-two-characters',
      });
      process.env.BETTER_AUTH_TRUSTED_ORIGINS = '*';
      vi.resetModules();
      const authServer = await import('@/lib/auth/server');
      sql = (await import('@/lib/db')).sql;
      expect(() => authServer.assertAuthConfigured()).toThrow('BETTER_AUTH_TRUSTED_ORIGINS must be unset');
    } finally {
      if (sql) await sql.end({ timeout: 5 });
      if (legacyOrigins === undefined) delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
      else process.env.BETTER_AUTH_TRUSTED_ORIGINS = legacyOrigins;
      restoreEnvironment(environment);
      vi.resetModules();
    }
  });

  it('does not initialize Better Auth while static collection lacks runtime configuration', async () => {
    const environment = captureEnvironment();
    let sql: Sql | undefined;

    try {
      configureProductionEnvironment({ databaseUrl: '', betterAuthUrl: 'https://darwin.example.test' });
      vi.resetModules();

      const authServer = await import('@/lib/auth/server');
      const database = await import('@/lib/db');
      sql = database.sql;
      expect(authServer.getAuth).toBeTypeOf('function');
      expect(() => database.assertDatabaseConfigured()).toThrow('DATABASE_URL is not configured');
      expect(() => authServer.assertAuthConfigured()).toThrow('BETTER_AUTH_SECRET must be a random value');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(() => authServer.getAuth()).toThrow('DATABASE_URL is not configured');
    } finally {
      if (sql) await sql.end({ timeout: 5 });
      restoreEnvironment(environment);
      vi.resetModules();
    }
  });

  it('returns a 503 instead of an insecure fallback when a production request lacks a secret', async () => {
    const environment = captureEnvironment();
    let sql: Sql | undefined;

    try {
      configureProductionEnvironment({
        // A syntactically valid unreachable URL proves the configuration check runs before any
        // database connection or Better Auth construction.
        databaseUrl: 'postgres://darwin-unconfigured.invalid:5432/darwin',
        betterAuthUrl: 'https://darwin.example.test',
      });
      vi.resetModules();

      const route = await import('@/app/api/auth/[...all]/route');
      sql = (await import('@/lib/db')).sql;
      const response = await route.GET(new Request('https://darwin.example.test/api/auth/get-session'));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: expect.stringContaining('BETTER_AUTH_SECRET must be a random value'),
      });
    } finally {
      if (sql) await sql.end({ timeout: 5 });
      restoreEnvironment(environment);
      vi.resetModules();
    }
  });

  it('rejects a plain HTTP authentication URL at production request time', async () => {
    const environment = captureEnvironment();
    let sql: Sql | undefined;

    try {
      configureProductionEnvironment({
        databaseUrl: '',
        betterAuthUrl: 'http://127.0.0.1:3000',
        secret: 'production-auth-test-secret-that-is-longer-than-thirty-two-characters',
      });
      vi.resetModules();

      const authServer = await import('@/lib/auth/server');
      const database = await import('@/lib/db');
      sql = database.sql;
      expect(authServer.getAuth).toBeTypeOf('function');
      expect(() => authServer.assertAuthConfigured()).toThrow('BETTER_AUTH_URL must use HTTPS in production');
    } finally {
      if (sql) await sql.end({ timeout: 5 });
      restoreEnvironment(environment);
      vi.resetModules();
    }
  });
});
