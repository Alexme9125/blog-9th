import { randomUUID } from "node:crypto";
import { chmod, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const configuredVariableNames = ["CADDY_SITE", "BETTER_AUTH_URL", "SITE_URL"];

export const usage = `Usage:
  pnpm site:configure --url https://journal.example.com --file .env
  pnpm site:configure --local --url http://127.0.0.1:3000 --file .env.local

The standard Docker Compose deployment accepts an HTTPS origin on port 443.
Use --local only for an HTTP loopback origin used by pnpm dev.`;

/**
 * @param {unknown} error
 * @param {string} code
 * @returns {error is NodeJS.ErrnoException}
 */
function isNodeError(error, code) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

/**
 * @param {string} message
 * @returns {Error}
 */
function argumentError(message) {
  return new Error(`${message}\n\n${usage}`);
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isExactLocalLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isValidDnsHostname(hostname) {
  if (hostname.length > 253) return false;

  return hostname.split(".").every((label) => {
    return (
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
    );
  });
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isAllowedHostname(hostname) {
  const normalized = hostname.toLowerCase();
  const ipAddress = normalized.replace(/^\[|\]$/gu, "");

  return (
    normalized === "localhost" ||
    isIP(ipAddress) !== 0 ||
    isValidDnsHostname(normalized)
  );
}

/**
 * The raw form has already been restricted to an authority and optional root
 * slash. Keep this check separate from URL normalization so shorthand IPv4
 * forms such as `127.1` cannot become an allowed local address.
 *
 * @param {string} value
 * @returns {string}
 */
function rawHostname(value) {
  const authorityWithOptionalSlash = value.slice(value.indexOf("://") + 3);
  const authority = authorityWithOptionalSlash.replace(/\/$/u, "");
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);

  if (hostAndPort.startsWith("[")) {
    const closingBracket = hostAndPort.indexOf("]");
    return closingBracket === -1
      ? hostAndPort
      : hostAndPort.slice(0, closingBracket + 1);
  }

  return hostAndPort.split(":")[0];
}

/**
 * Validates a canonical public origin before any environment file is read.
 * `--local` is deliberately limited to HTTP loopback addresses so it cannot
 * accidentally configure an insecure public deployment.
 *
 * @param {string} value
 * @param {{ local?: boolean }} [options]
 * @returns {{ publicUrl: string; caddySite: string; local: boolean }}
 */
export function parseSiteUrl(value, options = {}) {
  const local = options.local === true;

  if (typeof value !== "string" || value.length === 0) {
    throw argumentError("--url must be a non-empty URL.");
  }

  if (/[\u0000-\u001F\u007F-\u009F]/u.test(value)) {
    throw argumentError("--url must not contain control characters.");
  }

  if (/\s/u.test(value)) {
    throw argumentError("--url must not contain whitespace.");
  }

  if (value.includes("\\")) {
    throw argumentError("--url must not contain backslashes.");
  }

  if (value.includes("?") || value.includes("#")) {
    throw argumentError("--url must not include a query string or fragment.");
  }

  if (value.includes("*")) {
    throw argumentError("Wildcard domains are not allowed for --url.");
  }

  if (!/^[a-z][a-z\d+.-]*:\/\/[^/]+\/?$/iu.test(value)) {
    throw argumentError("--url must not include a path.");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw argumentError("--url must be a valid absolute URL.");
  }

  if (!url.hostname) {
    throw argumentError("--url must include a hostname.");
  }

  if (!isAllowedHostname(url.hostname)) {
    throw argumentError(
      "--url hostname must be a valid DNS name, IPv4 address, IPv6 address, or localhost.",
    );
  }

  if (url.hostname.includes("*")) {
    throw argumentError("Wildcard domains are not allowed for --url.");
  }

  if (url.username || url.password) {
    throw argumentError("--url must not include a username or password.");
  }

  if (url.pathname !== "/") {
    throw argumentError("--url must not include a path.");
  }

  if (url.search) {
    throw argumentError("--url must not include a query string.");
  }

  if (url.hash) {
    throw argumentError("--url must not include a fragment.");
  }

  if (local) {
    if (
      url.protocol !== "http:" ||
      !isExactLocalLoopbackHostname(url.hostname) ||
      !isExactLocalLoopbackHostname(rawHostname(value))
    ) {
      throw argumentError(
        "--local only permits an http:// URL on localhost, 127.0.0.1, or ::1.",
      );
    }
  } else {
    if (url.protocol !== "https:") {
      throw argumentError(
        "Production --url must use HTTPS. Use --local only for an HTTP loopback URL.",
      );
    }

    if (url.port) {
      throw argumentError(
        "The standard Docker Compose deployment only supports the default HTTPS port 443.",
      );
    }
  }

  return {
    publicUrl: url.origin,
    caddySite: url.hostname,
    local,
  };
}

/**
 * @param {string[]} argumentsList
 * @returns {{ environmentFile: string; site: { publicUrl: string; caddySite: string; local: boolean } }}
 */
export function parseSiteConfigureArguments(argumentsList) {
  /** @type {string | undefined} */
  let url;
  /** @type {string | undefined} */
  let environmentFile;
  let local = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === "--local") {
      if (local) throw argumentError("Pass --local at most once.");
      local = true;
      continue;
    }

    if (argument !== "--url" && argument !== "--file") {
      throw argumentError(`Unknown argument: ${argument}`);
    }

    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      throw argumentError(`${argument} requires a value.`);
    }
    index += 1;

    if (argument === "--url") {
      if (url !== undefined) throw argumentError("Pass --url exactly once.");
      url = value;
    } else {
      if (environmentFile !== undefined) {
        throw argumentError("Pass --file exactly once.");
      }
      environmentFile = value;
    }
  }

  if (url === undefined) throw argumentError("--url is required.");
  if (environmentFile === undefined) {
    throw argumentError(
      "--file is required; this command never searches for an environment file.",
    );
  }
  if (environmentFile.trim() !== environmentFile) {
    throw argumentError("--file must not include surrounding whitespace.");
  }

  return {
    environmentFile: resolve(process.cwd(), environmentFile),
    site: parseSiteUrl(url, { local }),
  };
}

/**
 * @param {string} contents
 * @returns {string}
 */
function preferredLineEnding(contents) {
  return contents.match(/\r\n|\n|\r/u)?.[0] ?? "\n";
}

/**
 * @param {string} value
 * @param {string} quote
 * @returns {number}
 */
function closingQuoteIndex(value, quote) {
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] !== quote) continue;

    let escapingBackslashes = 0;
    for (
      let cursor = index - 1;
      cursor >= 0 && value[cursor] === "\\";
      cursor -= 1
    ) {
      escapingBackslashes += 1;
    }

    if (escapingBackslashes % 2 === 0) return index;
  }

  return -1;
}

/**
 * Line-by-line replacement is unsafe when any value spans a line break: text
 * resembling SITE_URL inside that value is data, not an assignment. Refuse the
 * entire update instead of risking an unrelated secret or key.
 *
 * @param {string} contents
 * @returns {void}
 */
function assertNoMultilineQuotedValues(contents) {
  for (const line of contents.split(/\r\n|\n|\r/u)) {
    const assignment = line.match(
      /^\uFEFF?[ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*(.*)$/u,
    );
    if (!assignment) continue;

    const value = assignment[1];
    const quote = value[0];
    if (
      (quote === '"' || quote === "'") &&
      closingQuoteIndex(value, quote) === -1
    ) {
      throw new Error(
        "The environment file contains a multiline quoted value; refusing to modify it safely.",
      );
    }
  }
}

/**
 * @param {string} value
 * @param {string} nextValue
 * @param {string} variableName
 * @returns {string}
 */
function replacementValue(value, nextValue, variableName) {
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const closingIndex = closingQuoteIndex(value, quote);
    if (closingIndex === -1) {
      throw new Error(
        `${variableName} has an unterminated quoted value; refusing to modify the environment file.`,
      );
    }

    return `${quote}${nextValue}${value.slice(closingIndex)}`;
  }

  const commentIndex = value.indexOf("#");
  const valueBeforeComment =
    commentIndex === -1 ? value : value.slice(0, commentIndex);
  const trailingWhitespace = valueBeforeComment.match(/[ \t]*$/u)?.[0] ?? "";
  const comment = commentIndex === -1 ? "" : value.slice(commentIndex);

  return `${nextValue}${trailingWhitespace}${comment}`;
}

/**
 * @param {string} line
 * @param {Map<string, string>} values
 * @returns {{ line: string; variableName?: string }}
 */
function updateConfiguredLine(line, values) {
  const assignment = line.match(
    /^(\uFEFF?[ \t]*(?:export[ \t]+)?(CADDY_SITE|BETTER_AUTH_URL|SITE_URL)[ \t]*=[ \t]*)(.*)$/u,
  );
  if (!assignment) return { line };

  const [, prefix, variableName, value] = assignment;
  const nextValue = values.get(variableName);
  if (nextValue === undefined) return { line };

  return {
    line: `${prefix}${replacementValue(value, nextValue, variableName)}`,
    variableName,
  };
}

/**
 * Changes only CADDY_SITE, BETTER_AUTH_URL, and SITE_URL. Existing line
 * endings, comments, whitespace, quoting, and all unrelated entries remain
 * intact. Missing keys are appended in that order.
 *
 * @param {string} contents
 * @param {{ publicUrl: string; caddySite: string }} site
 * @returns {{ contents: string; changed: boolean }}
 */
export function updateEnvironmentContents(contents, site) {
  assertNoMultilineQuotedValues(contents);

  const values = new Map([
    ["CADDY_SITE", site.caddySite],
    ["BETTER_AUTH_URL", site.publicUrl],
    ["SITE_URL", site.publicUrl],
  ]);
  const found = new Set();

  let updated = contents
    .split(/(\r\n|\n|\r)/u)
    .map((part, index) => {
      if (index % 2 === 1) return part;

      const result = updateConfiguredLine(part, values);
      if (result.variableName) found.add(result.variableName);
      return result.line;
    })
    .join("");

  const missing = configuredVariableNames.filter((name) => !found.has(name));
  if (missing.length > 0) {
    const lineEnding = preferredLineEnding(contents);
    const separator =
      updated.length === 0 || /(?:\r\n|\n|\r)$/u.test(updated)
        ? ""
        : lineEnding;
    const entries = missing
      .map((name) => `${name}=${values.get(name)}`)
      .join(lineEnding);
    updated = `${updated}${separator}${entries}${lineEnding}`;
  }

  return { contents: updated, changed: updated !== contents };
}

/**
 * @param {string} environmentFile
 * @returns {Promise<{ contents: string; exists: boolean }>}
 */
async function readRegularEnvironmentFile(environmentFile) {
  try {
    const metadata = await lstat(environmentFile);
    if (!metadata.isFile()) {
      throw new Error(
        "Refusing to modify the environment file because it is not a regular file.",
      );
    }

    return { contents: await readFile(environmentFile, "utf8"), exists: true };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return { contents: "", exists: false };
    }

    throw error;
  }
}

/**
 * @param {string} environmentFile
 * @param {string} contents
 * @returns {Promise<void>}
 */
async function writeEnvironmentFileAtomically(environmentFile, contents) {
  const temporaryFile = resolve(
    dirname(environmentFile),
    `.${basename(environmentFile)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let createdTemporaryFile = false;
  let renamedTemporaryFile = false;

  try {
    const handle = await open(temporaryFile, "wx", 0o600);
    createdTemporaryFile = true;
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    await chmod(temporaryFile, 0o600);
    await rename(temporaryFile, environmentFile);
    renamedTemporaryFile = true;
  } finally {
    if (createdTemporaryFile && !renamedTemporaryFile) {
      await unlink(temporaryFile).catch(() => undefined);
    }
  }
}

/**
 * @param {{ publicUrl: string; caddySite: string }} site
 * @param {{ environmentFile: string }} options
 * @returns {Promise<{ changed: boolean; environmentFile: string }>}
 */
export async function writeSiteConfiguration(site, options) {
  if (!options?.environmentFile) {
    throw new Error("An explicit environmentFile is required.");
  }

  const environmentFile = resolve(options.environmentFile);
  const environment = await readRegularEnvironmentFile(environmentFile);
  const update = updateEnvironmentContents(environment.contents, site);

  if (update.changed || !environment.exists) {
    await writeEnvironmentFileAtomically(environmentFile, update.contents);
  } else {
    await chmod(environmentFile, 0o600);
  }

  return { changed: update.changed, environmentFile };
}

/**
 * @param {string[]} [argumentsList]
 * @returns {Promise<void>}
 */
export async function main(argumentsList = process.argv.slice(2)) {
  if (
    argumentsList.length === 1 &&
    (argumentsList[0] === "--help" || argumentsList[0] === "-h")
  ) {
    console.info(usage);
    return;
  }

  const { environmentFile, site } = parseSiteConfigureArguments(argumentsList);
  await writeSiteConfiguration(site, { environmentFile });
  console.info(
    `Updated CADDY_SITE, BETTER_AUTH_URL, and SITE_URL in ${environmentFile}.`,
  );
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Could not configure the site URL.",
    );
    process.exitCode = 1;
  });
}
