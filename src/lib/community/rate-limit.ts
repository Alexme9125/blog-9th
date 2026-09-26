import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class CommunityRateLimitError extends Error {
  readonly code = 'RATE_LIMITED';

  constructor() {
    super('Please try again later.');
  }
}

type RateLimit = { scope: string; bucket: string; limit: number; windowMs: number };

const subscribeLimits = {
  email: { limit: 3, windowMs: 60 * 60 * 1_000 },
  ip: { limit: 10, windowMs: 15 * 60 * 1_000 },
  global: { limit: 40, windowMs: 15 * 60 * 1_000 },
};
const applicationLimits = {
  email: { limit: 2, windowMs: 24 * 60 * 60 * 1_000 },
  ip: { limit: 5, windowMs: 24 * 60 * 60 * 1_000 },
  global: { limit: 15, windowMs: 60 * 60 * 1_000 },
};
const tokenLimits = {
  ip: { limit: 20, windowMs: 15 * 60 * 1_000 },
  global: { limit: 50, windowMs: 15 * 60 * 1_000 },
};

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function bucket(kind: string, value: string): string {
  return digest(`darwin-community-rate-limit:v1:${kind}:${value}`);
}

function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * `X-Forwarded-For` and `X-Real-IP` are deliberately never accepted here: callers can forge
 * them unless a proxy removes inbound values. A deployment may instead inject a dedicated IP
 * header plus a private proof header after stripping client-supplied versions.
 */
export function trustedCommunityRequestIp(requestHeaders: Headers): string | null {
  const ipHeader = process.env.COMMUNITY_TRUSTED_IP_HEADER?.trim().toLowerCase();
  const proof = process.env.COMMUNITY_TRUSTED_IP_PROOF?.trim();
  if (!ipHeader || !proof || !/^[a-z0-9-]{1,80}$/.test(ipHeader)) return null;

  const suppliedProof = requestHeaders.get('x-darwin-community-ip-proof');
  if (!suppliedProof) return null;
  const expected = Buffer.from(proof, 'utf8');
  const actual = Buffer.from(suppliedProof, 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const candidate = requestHeaders.get(ipHeader)?.trim();
  if (!candidate || candidate.includes(',') || candidate.includes('%') || isIP(candidate) === 0) return null;
  return candidate.toLowerCase();
}

async function increment(tx: Transaction, limit: RateLimit, now: Date): Promise<boolean> {
  const startedAt = windowStart(now, limit.windowMs);
  // postgres.js' raw execute path does not encode Date objects when `prepare: false`.
  const startedAtIso = startedAt.toISOString();
  const nowIso = now.toISOString();
  const result = await tx.execute(sql`
    insert into "community_rate_limits" ("scope", "bucket", "window_started_at", "count", "updated_at")
    values (${limit.scope}, ${limit.bucket}, ${startedAtIso}, 1, ${nowIso})
    on conflict ("scope", "bucket", "window_started_at") do update
      set "count" = "community_rate_limits"."count" + 1,
          "updated_at" = ${nowIso}
      where "community_rate_limits"."count" < ${limit.limit}
    returning "count"
  `);
  return result.length > 0;
}

function publicLimits(
  action: 'subscribe' | 'application' | 'token',
  input: { email?: string; ip?: string },
): RateLimit[] {
  if (action === 'token') {
    return [
      { scope: 'community:token:global', bucket: 'global', ...tokenLimits.global },
      ...(input.ip ? [{ scope: 'community:token:ip', bucket: bucket('ip', input.ip), ...tokenLimits.ip }] : []),
    ];
  }
  const limits = action === 'subscribe' ? subscribeLimits : applicationLimits;
  return [
    { scope: `community:${action}:global`, bucket: 'global', ...limits.global },
    ...(input.email ? [{ scope: `community:${action}:email`, bucket: bucket('email', input.email), ...limits.email }] : []),
    ...(input.ip ? [{ scope: `community:${action}:ip`, bucket: bucket('ip', input.ip), ...limits.ip }] : []),
  ];
}

/** Every increment runs inside the caller transaction: one rejected bucket rolls all counters back. */
export async function consumePublicCommunityRateLimit(
  tx: Transaction,
  action: 'subscribe' | 'application' | 'token',
  input: { email?: string; ip?: string },
  now = new Date(),
): Promise<void> {
  for (const limit of publicLimits(action, input)) {
    if (!(await increment(tx, limit, now))) throw new CommunityRateLimitError();
  }
}
