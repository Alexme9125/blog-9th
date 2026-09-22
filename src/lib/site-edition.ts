import "server-only";

export const siteEditions = ["classic", "anniversary-9"] as const;

export type SiteEdition = (typeof siteEditions)[number];

export const defaultSiteEdition: SiteEdition = "classic";

/**
 * Returns the supported edition for an environment value. Whitespace is
 * tolerated, while an omitted or invalid value uses this branch's default.
 */
export function parseSiteEdition(value: string | undefined): SiteEdition {
  const normalized = value?.trim();

  if (normalized === "classic" || normalized === "anniversary-9") {
    return normalized;
  }

  return defaultSiteEdition;
}

/**
 * Reads the server-only runtime setting for the site's visual edition.
 */
export function getSiteEdition(): SiteEdition {
  return parseSiteEdition(process.env.SITE_EDITION);
}
