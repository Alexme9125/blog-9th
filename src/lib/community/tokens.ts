import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  communityActionTokens,
  type CommunityActionTokenPurpose,
} from '@/lib/db/community-schema';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const COMMUNITY_TOKEN_TTL = {
  confirmation: 48 * 60 * 60 * 1_000,
  applicationReceipt: 48 * 60 * 60 * 1_000,
  unsubscribe: null,
} as const;

export function hashCommunityToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A 256-bit opaque token. Only its SHA-256 digest is retained by the database. */
export async function issueCommunityToken(
  tx: Transaction,
  input: {
    purpose: CommunityActionTokenPurpose;
    subscriberId?: string;
    applicationId?: string;
    ttlMs: number | null;
    now?: Date;
  },
): Promise<{ token: string; expiresAt: Date | null }> {
  if (Boolean(input.subscriberId) === Boolean(input.applicationId)) {
    throw new Error('A community action token needs exactly one target.');
  }
  const token = randomBytes(32).toString('base64url');
  const now = input.now ?? new Date();
  const expiresAt = input.ttlMs === null ? null : new Date(now.getTime() + input.ttlMs);
  await tx.insert(communityActionTokens).values({
    tokenHash: hashCommunityToken(token),
    purpose: input.purpose,
    ...(input.subscriberId ? { subscriberId: input.subscriberId } : {}),
    ...(input.applicationId ? { applicationId: input.applicationId } : {}),
    expiresAt,
  });
  return { token, expiresAt };
}

/** Atomically makes a non-expired token single-use and returns only its target IDs. */
export async function consumeCommunityToken(
  tx: Transaction,
  token: string,
  purpose: CommunityActionTokenPurpose,
  now = new Date(),
): Promise<{ subscriberId: string | null; applicationId: string | null } | null> {
  const [used] = await tx
    .update(communityActionTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(communityActionTokens.tokenHash, hashCommunityToken(token)),
        eq(communityActionTokens.purpose, purpose),
        isNull(communityActionTokens.usedAt),
        ...(purpose === 'unsubscribe' ? [] : [gt(communityActionTokens.expiresAt, now)]),
      ),
    )
    .returning({ subscriberId: communityActionTokens.subscriberId, applicationId: communityActionTokens.applicationId });
  return used ?? null;
}
