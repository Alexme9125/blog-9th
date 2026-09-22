import { randomUUID } from "node:crypto";
import { chmod, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

export const siteEditionValues = ["classic", "anniversary-9"];
export const usage = "Usage: pnpm site:edition <classic|anniversary-9>";

/**
 * @typedef {"classic" | "anniversary-9"} SiteEdition
 */

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
 * @param {string} value
 * @returns {asserts value is SiteEdition}
 */
function assertSiteEdition(value) {
  if (!siteEditionValues.includes(value)) {
    throw new Error(usage);
  }
}

/**
 * @param {string[]} argumentsList
 * @returns {SiteEdition}
 */
export function parseEditionArgument(argumentsList) {
  if (argumentsList.length !== 1) {
    throw new Error(usage);
  }

  const [edition] = argumentsList;
  assertSiteEdition(edition);
  return edition;
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

    if (escapingBackslashes % 2 === 0) {
      return index;
    }
  }

  return -1;
}

/**
 * @param {string} value
 * @param {SiteEdition} edition
 * @returns {string}
 */
function replacementValue(value, edition) {
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const closingIndex = closingQuoteIndex(value, quote);
    if (closingIndex === -1) {
      throw new Error(
        "SITE_EDITION has an unterminated quoted value; refusing to modify .env.local.",
      );
    }

    return `${quote}${edition}${value.slice(closingIndex)}`;
  }

  const commentIndex = value.indexOf("#");
  const valueBeforeComment =
    commentIndex === -1 ? value : value.slice(0, commentIndex);
  const trailingWhitespace = valueBeforeComment.match(/[ \t]*$/u)?.[0] ?? "";
  const comment = commentIndex === -1 ? "" : value.slice(commentIndex);

  return `${edition}${trailingWhitespace}${comment}`;
}

/**
 * @param {string} line
 * @param {SiteEdition} edition
 * @returns {{ line: string; matched: boolean }}
 */
function updateSiteEditionLine(line, edition) {
  const assignment = line.match(
    /^(\uFEFF?[ \t]*(?:export[ \t]+)?SITE_EDITION[ \t]*=[ \t]*)(.*)$/u,
  );
  if (!assignment) {
    return { line, matched: false };
  }

  return {
    line: `${assignment[1]}${replacementValue(assignment[2], edition)}`,
    matched: true,
  };
}

/**
 * Changes only SITE_EDITION assignments. Existing line endings, comments,
 * whitespace, quoting, and every other environment entry remain intact.
 *
 * @param {string} contents
 * @param {SiteEdition} edition
 * @returns {{ contents: string; changed: boolean }}
 */
export function updateEnvironmentContents(contents, edition) {
  assertSiteEdition(edition);

  let found = false;
  const updated = contents
    .split(/(\r\n|\n|\r)/u)
    .map((part, index) => {
      if (index % 2 === 1) return part;

      const result = updateSiteEditionLine(part, edition);
      found ||= result.matched;
      return result.line;
    })
    .join("");

  if (found) {
    return { contents: updated, changed: updated !== contents };
  }

  const lineEnding = preferredLineEnding(contents);
  const separator =
    contents.length === 0 || /(?:\r\n|\n|\r)$/u.test(contents)
      ? ""
      : lineEnding;

  return {
    contents: `${contents}${separator}SITE_EDITION=${edition}${lineEnding}`,
    changed: true,
  };
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
        "Refusing to modify .env.local because it is not a regular file.",
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
 * @param {SiteEdition} edition
 * @param {{ environmentFile?: string }} [options]
 * @returns {Promise<{ changed: boolean; environmentFile: string }>}
 */
export async function writeSiteEdition(edition, options = {}) {
  assertSiteEdition(edition);
  const environmentFile =
    options.environmentFile ?? resolve(process.cwd(), ".env.local");
  const environment = await readRegularEnvironmentFile(environmentFile);
  const update = updateEnvironmentContents(environment.contents, edition);

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

  const edition = parseEditionArgument(argumentsList);
  await writeSiteEdition(edition);
  console.info(`Set SITE_EDITION=${edition} in .env.local.`);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Could not update SITE_EDITION.",
    );
    process.exitCode = 1;
  });
}
