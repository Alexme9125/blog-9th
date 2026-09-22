/**
 * Proxy headers describe internal hops after TLS termination, not necessarily the
 * browser's origin. Only deployment/admin configuration may grant origin trust.
 */
export function isTrustedMutationOrigin(
  request: Request,
  trustedOrigins: readonly string[],
): boolean {
  const origin = request.headers.get("origin");
  if (!origin || !trustedOrigins.includes(origin)) return false;
  try {
    const parsed = new URL(origin);
    // Do not normalize paths, credentials or malformed origins into trusted ones.
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin
    )
      return false;
  } catch {
    return false;
  }

  // Browsers cannot script this header. Older clients may omit it, but must still
  // supply an exact configured Origin; Host/X-Forwarded-* never provide a fallback.
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}
