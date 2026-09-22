'use server';

import { requireMutationUser, requireRole } from '@/lib/auth/server';
import { revalidatePublicContent, safeActionError } from '@/lib/cms/internal';
import type { ActionResult } from '@/lib/cms/types';
import { ValidationError } from '@/lib/cms/validation';
import { assertDatabaseConfigured, db } from '@/lib/db';
import { auditLog, settings } from '@/lib/db/schema';

import { SITE_ACCESS_KEY, type SiteAccessConfig, validateSiteAccessConfig } from './config';
import { getEffectivePublicUrl, getEffectiveTrustedOrigins, readSiteAccessConfig } from './store';

export type AdminSiteAccess = {
  config: SiteAccessConfig;
  publicUrl: string;
  environmentOrigin: string;
  trustedOrigins: string[];
  production: boolean;
};

function failure<T = undefined>(error: string, code?: string): ActionResult<T> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** The environment entry stays in the list so an administrator has a recovery route. */
function environmentOrigin(): string {
  const configured =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_BETTER_AUTH_URL?.trim() ||
    'http://localhost:3000';

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new ValidationError('BETTER_AUTH_URL 必须是完整的 HTTP 或 HTTPS 地址。');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ValidationError('BETTER_AUTH_URL 必须是完整的 HTTP 或 HTTPS 地址。');
  }
  return parsed.origin;
}

async function siteAccessData(): Promise<AdminSiteAccess> {
  const production = isProduction();
  const origin = environmentOrigin();
  const [config, publicUrl, trustedOrigins] = await Promise.all([
    readSiteAccessConfig(),
    getEffectivePublicUrl(),
    getEffectiveTrustedOrigins(origin, production),
  ]);
  return { config, publicUrl, environmentOrigin: origin, trustedOrigins, production };
}

export async function getAdminSiteAccess(): Promise<AdminSiteAccess> {
  await requireRole(['admin']);
  assertDatabaseConfigured();
  return siteAccessData();
}

export async function saveSiteAccess(input: SiteAccessConfig): Promise<ActionResult<AdminSiteAccess>> {
  const actor = await requireMutationUser(['admin']);
  assertDatabaseConfigured();

  try {
    const value = validateSiteAccessConfig(input, isProduction());
    await db.transaction(async (tx) => {
      await tx
        .insert(settings)
        .values({ key: SITE_ACCESS_KEY, value, updatedAt: new Date() })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'site_access.save',
        resourceId: SITE_ACCESS_KEY,
        detail: { publicUrl: value.publicUrl, trustedOrigins: value.trustedOrigins },
      });
    });

    revalidatePublicContent();
    return { ok: true, data: await siteAccessData() };
  } catch (error) {
    const result = safeActionError(error, '保存访问地址失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}
