import 'server-only';

import { eq } from 'drizzle-orm';

import { trustedAuthOrigins } from '@/lib/auth/origins';
import { ValidationError } from '@/lib/cms/validation';
import { assertDatabaseConfigured, db } from '@/lib/db';
import { settings } from '@/lib/db/schema';

import { SITE_ACCESS_KEY, type SiteAccessConfig, normalizeSiteOrigin, validateSiteAccessConfig } from './config';

function emptyConfig(): SiteAccessConfig {
  return { publicUrl: '', trustedOrigins: [] };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * This deliberately performs a fresh query. The current set of aliases must follow database
 * updates, rather than becoming a process-lifetime authentication configuration.
 */
async function readStoredSiteAccessConfig(production: boolean): Promise<SiteAccessConfig> {
  assertDatabaseConfigured();
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SITE_ACCESS_KEY)).limit(1);
  if (!row) return emptyConfig();

  try {
    // Do not recover individual fields from old or malformed values. A partial recovery could
    // accidentally turn an origin that no longer satisfies the current rules into a trusted one.
    return validateSiteAccessConfig(row.value, production);
  } catch (error) {
    if (error instanceof ValidationError) return emptyConfig();
    throw error;
  }
}

export async function readSiteAccessConfig(): Promise<SiteAccessConfig> {
  return readStoredSiteAccessConfig(isProduction());
}

function normalizedEnvironmentOrigin(value: string | undefined, production: boolean): string | undefined {
  const input = value?.trim();
  if (!input) return undefined;
  try {
    return normalizeSiteOrigin(input, production);
  } catch (error) {
    if (error instanceof ValidationError) return undefined;
    throw error;
  }
}

export async function getEffectivePublicUrl(): Promise<string> {
  const production = isProduction();
  const stored = await readStoredSiteAccessConfig(production);
  if (stored.publicUrl) return stored.publicUrl;

  const environmentOrigin =
    normalizedEnvironmentOrigin(process.env.SITE_URL, production) ??
    normalizedEnvironmentOrigin(process.env.BETTER_AUTH_URL, production);
  if (environmentOrigin) return environmentOrigin;
  if (production) throw new ValidationError('生产环境必须设置有效的 SITE_URL 或 BETTER_AUTH_URL。');
  return 'http://127.0.0.1:3000';
}

/**
 * Start from Better Auth's environment-derived entries, then add the canonical public origin
 * and explicit aliases. It accepts no request data, so untrusted Host and Origin headers can
 * never expand the allow-list.
 */
export async function getEffectiveTrustedOrigins(baseUrl: string, production: boolean): Promise<string[]> {
  const [environmentOrigins, stored] = await Promise.all([
    Promise.resolve(trustedAuthOrigins(baseUrl, production)),
    readStoredSiteAccessConfig(production),
  ]);

  return [...new Set([...environmentOrigins, ...(stored.publicUrl ? [stored.publicUrl] : []), ...stored.trustedOrigins])];
}
