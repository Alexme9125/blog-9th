import 'server-only';

import { headers } from 'next/headers';

import { getTrustedRequestOrigins } from '@/lib/auth/server';

import { trustedCommunityRequestIp } from './rate-limit';

export class CommunityOriginError extends Error {
  readonly code = 'INVALID_ORIGIN';

  constructor() {
    super('This request did not come from a trusted site origin.');
  }
}

export type CommunityRequestContext = { ip: string | null };

/**
 * Next's Server Action CSRF defense is the first line of protection. This explicit check keeps
 * the data layer safe when an action reference is invoked directly, and never treats Host or
 * forwarded host headers as proof of a browser origin.
 */
export async function requireTrustedCommunityRequest(): Promise<CommunityRequestContext> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get('origin');
  const trustedOrigins = await getTrustedRequestOrigins();
  if (!origin || !trustedOrigins.includes(origin)) throw new CommunityOriginError();

  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      throw new CommunityOriginError();
    }
  } catch {
    throw new CommunityOriginError();
  }

  const fetchSite = requestHeaders.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') throw new CommunityOriginError();
  return { ip: trustedCommunityRequestIp(requestHeaders) };
}
