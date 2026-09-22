import { ValidationError, isPlainObject } from '@/lib/cms/validation';

export type SiteAccessConfig = {
  publicUrl: string;
  trustedOrigins: string[];
};

export const SITE_ACCESS_KEY = 'site_access';

const MAX_TRUSTED_ORIGINS = 10;
const MAX_ORIGIN_LENGTH = 2_048;
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function fail(message: string): never {
  throw new ValidationError(message);
}

function isHostPortWithoutScheme(value: string): boolean {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(value);
  return Boolean(match && /^\d+(?:\/|$)/.test(match[2] ?? ''));
}

function isValidHostname(hostname: string): boolean {
  // URL has already verified the IPv6 grammar. Keep the character check explicit so a
  // hostname with punctuation accepted by the generic URL parser cannot become trusted.
  if (hostname.startsWith('[') && hostname.endsWith(']')) return /^\[[0-9A-Fa-f:.]+\]$/.test(hostname);
  if (!hostname || hostname.length > 253) return false;
  return hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

/**
 * Only a complete HTTP(S) origin is accepted. A bare host is a convenience input for
 * administrators and is always treated as HTTPS.
 */
export function normalizeSiteOrigin(input: string, production: boolean): string {
  if (typeof input !== 'string') fail('站点地址必须是文本。');
  if (input.length > MAX_ORIGIN_LENGTH) fail(`站点地址不能超过 ${MAX_ORIGIN_LENGTH} 个字符。`);

  const value = input.trim();
  if (!value) fail('站点地址不能为空。');
  if (/[*\\?#@\u0000-\u001f\u007f\s\u200b\ufeff]/u.test(value)) {
    fail('站点地址只能是完整的公开来源。');
  }
  if (value.startsWith('//')) fail('站点地址必须包含协议。');

  const explicitScheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(value);
  if (!explicitScheme && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !isHostPortWithoutScheme(value)) {
    fail('站点地址协议不正确。');
  }

  const candidate = explicitScheme ? value : `https://${value}`;
  const afterAuthority = candidate.slice(candidate.indexOf('://') + 3);
  const slashIndex = afterAuthority.indexOf('/');
  if (slashIndex >= 0 && afterAuthority.slice(slashIndex) !== '/') {
    // Do this before URL parsing: URL normalizes paths such as /path/.. back to /.
    fail('站点地址不能包含路径。');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    fail('站点地址格式不正确。');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    fail('站点地址只能使用 HTTP 或 HTTPS。');
  }
  if (parsed.hostname.endsWith('.')) parsed.hostname = parsed.hostname.slice(0, -1);
  if (parsed.username || parsed.password) fail('站点地址不能包含登录凭据。');
  if (!isValidHostname(parsed.hostname) || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail('站点地址只能是完整的公开来源。');
  }
  if (production && parsed.protocol !== 'https:') {
    fail('生产环境的站点地址必须使用 HTTPS。');
  }
  if (!production && parsed.protocol === 'http:' && !loopbackHosts.has(parsed.hostname)) {
    fail('HTTP 仅可用于本机开发地址。');
  }

  return parsed.origin;
}

/** Validate the independently stored public origin and its explicit authentication aliases. */
export function validateSiteAccessConfig(input: unknown, production: boolean): SiteAccessConfig {
  if (!isPlainObject(input)) fail('站点访问设置必须是对象。');
  for (const key of Object.keys(input)) {
    if (key !== 'publicUrl' && key !== 'trustedOrigins') fail(`站点访问设置包含不支持的字段：${key}。`);
  }

  if (typeof input.publicUrl !== 'string') fail('公开站点地址必须是文本。');
  if (!Array.isArray(input.trustedOrigins)) fail('受信任来源必须是列表。');
  if (input.trustedOrigins.length > MAX_TRUSTED_ORIGINS) fail(`受信任来源最多只能设置 ${MAX_TRUSTED_ORIGINS} 个。`);

  const publicUrlInput = input.publicUrl.trim();
  const publicUrl = publicUrlInput ? normalizeSiteOrigin(publicUrlInput, production) : '';
  const trustedOrigins = [...new Set(input.trustedOrigins.map((origin) => normalizeSiteOrigin(origin, production)))];
  if (trustedOrigins.length > MAX_TRUSTED_ORIGINS) fail(`受信任来源最多只能设置 ${MAX_TRUSTED_ORIGINS} 个。`);

  return { publicUrl, trustedOrigins };
}
