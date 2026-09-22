import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { AdminUser, Role } from '@/lib/cms/types';
import { trustedAuthOrigins } from '@/lib/auth/origins';
import { getEffectiveTrustedOrigins } from '@/lib/site-access/store';
import { normalizeSiteOrigin } from '@/lib/site-access/config';
import { assertDatabaseConfigured, db } from '@/lib/db';
import { accounts, rateLimits, sessions, users, verifications } from '@/lib/db/schema';

const isProduction = process.env.NODE_ENV === 'production';
const authBaseUrl =
  process.env.BETTER_AUTH_URL?.trim() ||
  process.env.NEXT_PUBLIC_BETTER_AUTH_URL?.trim() ||
  'http://localhost:3000';

const authSchema = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  rateLimit: rateLimits,
};

const minimumSecretLength = 32;
const defaultBetterAuthSecret = 'better-auth-secret-12345678901234567890';

function configuredAuthSecret(): string | undefined {
  return process.env.BETTER_AUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
}

export class AuthConfigurationError extends Error {
  constructor(message = 'BETTER_AUTH_SECRET must be a random value of at least 32 characters before handling authentication requests.') {
    super(message);
    this.name = 'AuthConfigurationError';
  }
}

/**
 * Keep this check out of module initialization: `next build` imports route modules but must not
 * require deployment secrets. Every authentication request invokes it before Better Auth starts.
 */
export function assertAuthConfigured(): void {
  const secret = configuredAuthSecret();
  if (!secret || secret.length < minimumSecretLength || secret === defaultBetterAuthSecret) {
    throw new AuthConfigurationError();
  }
  // Better Auth appends this legacy variable outside our per-request origin resolver.
  // Reject a second allow-list so removing an address in site settings takes effect reliably.
  if (process.env.BETTER_AUTH_TRUSTED_ORIGINS?.trim()) {
    throw new AuthConfigurationError('Manage additional login addresses in site settings; BETTER_AUTH_TRUSTED_ORIGINS must be unset.');
  }

  let configuredUrl: URL;
  try {
    configuredUrl = new URL(authBaseUrl);
  } catch {
    throw new AuthConfigurationError('BETTER_AUTH_URL must be an absolute URL before handling authentication requests.');
  }
  if (isProduction && configuredUrl.protocol !== 'https:') {
    throw new AuthConfigurationError('BETTER_AUTH_URL must use HTTPS in production so Secure authentication cookies can be delivered.');
  }
  try {
    normalizeSiteOrigin(authBaseUrl, isProduction);
  } catch {
    throw new AuthConfigurationError('BETTER_AUTH_URL must be an exact HTTP(S) origin without wildcard, credentials, path, query, or fragment.');
  }
}

function createAuth() {
  return betterAuth({
    appName: 'Darwin Journal',
    baseURL: authBaseUrl,
    // Initialization has no request: keep its context free of database aliases so a removed
    // alias cannot remain trusted in the singleton. HTTP requests always read current settings.
    trustedOrigins: async (request) => request
      ? getEffectiveTrustedOrigins(authBaseUrl, isProduction)
      : trustedAuthOrigins(authBaseUrl, isProduction),
    secret: configuredAuthSecret(),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: authSchema,
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
    session: {
      // An authoritative database lookup is required for revoked or disabled users.
      cookieCache: { enabled: false },
    },
    // Database storage keeps the built-in /sign-in 3-per-10-second protection shared across
    // horizontally scaled server instances. The default production-only enablement remains intact.
    rateLimit: {
      storage: 'database',
    },
    advanced: {
      // Keep the same protection in tests; Better Auth otherwise skips origin checks in test mode.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: 'darwin',
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        path: '/',
      },
    },
    // Registration and email reset flows are admin-only operations for this site.
    disabledPaths: ['/sign-up/email', '/request-password-reset', '/reset-password'],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const [user] = await db
              .select({ disabled: users.disabled })
              .from(users)
              .where(eq(users.id, session.userId))
              .limit(1);

            return Boolean(user && !user.disabled);
          },
        },
      },
    },
    // Keep this last so session cookie changes made in server actions reach Next.
    plugins: [nextCookies()],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;

let authInstance: AuthInstance | undefined;

/**
 * Better Auth creates an asynchronous context as soon as its factory runs. Do not initialize it
 * during Next's static module collection: a production image intentionally receives no secret at
 * build time. Runtime callers must pass both configuration checks before this factory can run.
 */
export function getAuth(): AuthInstance {
  assertDatabaseConfigured();
  assertAuthConfigured();
  authInstance ??= createAuth();
  return authInstance;
}

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';

  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class PasswordChangeRequiredError extends Error {
  readonly code = 'PASSWORD_CHANGE_REQUIRED';

  constructor() {
    super('You must change your password before making changes.');
    this.name = 'PasswordChangeRequiredError';
  }
}

function toAdminUser(user: typeof users.$inferSelect): AdminUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    mustChangePassword: user.mustChangePassword,
  };
}

async function getSessionUserFromRequestHeaders(requestHeaders: Headers): Promise<AdminUser | null> {
  assertDatabaseConfigured();
  assertAuthConfigured();

  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) {
    return null;
  }

  // Do not trust role or disabled state serialized with the session. This query is deliberately
  // uncached so permission changes and account disabling take effect on the next request.
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user || user.disabled) {
    await db
      .delete(sessions)
      .where(and(eq(sessions.id, session.session.id), eq(sessions.userId, session.user.id)));
    return null;
  }

  return toAdminUser(user);
}

export async function getSessionUser(): Promise<AdminUser | null> {
  return getSessionUserFromRequestHeaders(await headers());
}

export async function requireUser(): Promise<AdminUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect('/admin/login');
  }

  return user;
}

export async function requireRole(roles: Role[]): Promise<AdminUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw new AuthorizationError();
  }

  return user;
}

export function assertPasswordChangeComplete(user: AdminUser): void {
  if (user.mustChangePassword) {
    throw new PasswordChangeRequiredError();
  }
}

/**
 * Use for any data-changing server action. Password changes intentionally call requireUser()
 * directly so a newly provisioned account can complete its required password change.
 */
export async function requireMutationUser(roles?: Role[]): Promise<AdminUser> {
  const user = roles ? await requireRole(roles) : await requireUser();
  assertPasswordChangeComplete(user);
  return user;
}

export { getSessionUserFromRequestHeaders };
