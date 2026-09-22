/** Trust only the configured origin, plus exact local aliases during development. */
export function trustedAuthOrigins(
  baseUrl: string,
  production: boolean,
): string[] {
  const configured = new URL(baseUrl);
  const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"];
  if (
    production ||
    !loopbackHosts.includes(configured.hostname) ||
    !["http:", "https:"].includes(configured.protocol)
  ) {
    return [configured.origin];
  }

  return loopbackHosts.map((hostname) => {
    const alias = new URL(configured.origin);
    alias.hostname = hostname;
    return alias.origin;
  });
}
