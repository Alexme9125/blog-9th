/** The app must sit behind a proxy that replaces forwarded host/protocol headers. */
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const protocol =
    request.headers.get("x-forwarded-proto") ||
    new URL(request.url).protocol.slice(0, -1);
  if (!origin || !host || !["http", "https"].includes(protocol)) return false;
  try {
    const expected = new URL(`${protocol}://${host}`);
    if (expected.username || expected.password || expected.host !== host)
      return false;
    return origin === expected.origin;
  } catch {
    return false;
  }
}
