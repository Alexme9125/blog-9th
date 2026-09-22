import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultSiteEdition,
  getSiteEdition,
  parseSiteEdition,
} from "@/lib/site-edition";
import {
  parseEditionArgument,
  updateEnvironmentContents,
  writeSiteEdition,
} from "../scripts/set-site-edition.mjs";

const originalSiteEdition = process.env.SITE_EDITION;

afterEach(() => {
  if (originalSiteEdition === undefined) {
    delete process.env.SITE_EDITION;
  } else {
    process.env.SITE_EDITION = originalSiteEdition;
  }
});

describe("site edition runtime setting", () => {
  it("uses the branch default for omitted and invalid values", () => {
    expect(parseSiteEdition(undefined)).toBe(defaultSiteEdition);
    expect(parseSiteEdition(" ninth-anniversary ")).toBe(defaultSiteEdition);
    expect(parseSiteEdition(" classic ")).toBe("classic");

    delete process.env.SITE_EDITION;
    expect(getSiteEdition()).toBe(defaultSiteEdition);
    process.env.SITE_EDITION = "anniversary-9";
    expect(getSiteEdition()).toBe("anniversary-9");
  });
});

describe("site:edition command helpers", () => {
  it("updates only SITE_EDITION while preserving line endings, comments, quotes, and other values", () => {
    const contents = [
      "# Keep this comment exactly",
      "DATABASE_URL=postgresql://kept-user:kept-password@127.0.0.1:55432/darwin",
      'export SITE_EDITION = "classic" # preserve this comment',
      "SITE_URL=http://127.0.0.1:3000",
      "",
    ].join("\r\n");

    expect(updateEnvironmentContents(contents, "anniversary-9")).toEqual({
      changed: true,
      contents: [
        "# Keep this comment exactly",
        "DATABASE_URL=postgresql://kept-user:kept-password@127.0.0.1:55432/darwin",
        'export SITE_EDITION = "anniversary-9" # preserve this comment',
        "SITE_URL=http://127.0.0.1:3000",
        "",
      ].join("\r\n"),
    });
  });

  it("rejects missing, extra, and unsupported command arguments before any file write", () => {
    expect(() => parseEditionArgument([])).toThrow("Usage: pnpm site:edition");
    expect(() => parseEditionArgument(["classic", "extra"])).toThrow(
      "Usage: pnpm site:edition",
    );
    expect(() => parseEditionArgument(["ninth"])).toThrow(
      "Usage: pnpm site:edition",
    );
  });

  it("writes a private .env.local without changing unrelated entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "darwin-site-edition-"));
    const environmentFile = join(directory, ".env.local");

    try {
      const original =
        "DATABASE_URL=postgresql://kept-user:kept-password@localhost/darwin\nSITE_URL=http://127.0.0.1:3000\n";
      await writeFile(environmentFile, original, {
        encoding: "utf8",
        mode: 0o644,
      });
      await chmod(environmentFile, 0o644);

      await writeSiteEdition("classic", { environmentFile });

      expect(await readFile(environmentFile, "utf8")).toBe(
        `${original}SITE_EDITION=classic\n`,
      );
      expect((await stat(environmentFile)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
