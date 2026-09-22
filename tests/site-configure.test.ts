import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  main,
  parseSiteConfigureArguments,
  parseSiteUrl,
  updateEnvironmentContents,
  writeSiteConfiguration,
} from "../scripts/site-configure.mjs";

describe("site:configure URL validation", () => {
  it("normalizes a default-port HTTPS origin for the standard Compose deployment", () => {
    expect(parseSiteUrl("https://Journal.Example.com:443")).toEqual({
      publicUrl: "https://journal.example.com",
      caddySite: "journal.example.com",
      local: false,
    });
  });

  it("requires HTTPS production URLs with a single host and no URL extras", () => {
    for (const value of [
      "http://journal.example.com",
      "https://journal.example.com:8443",
      "https://admin:password@journal.example.com",
      "https://journal.example.com/settings",
      "https://journal.example.com?preview=1",
      "https://journal.example.com#top",
      "https://*.example.com",
      "https://exa$mple.com",
      "https://journal.example.com/.",
      "https://journal.example.com/a/..",
      "https://journal.example.com?",
      "https://journal.example.com#",
      "https://journal.example.com\\settings",
      "https://journal.example.com with-space",
      "https://journal.example.com\u0000invalid",
      "https://journal.example.com\u0081invalid",
    ]) {
      expect(() => parseSiteUrl(value)).toThrow();
    }
  });

  it("permits HTTP only when --local explicitly selects a loopback origin", () => {
    expect(
      parseSiteConfigureArguments([
        "--local",
        "--url",
        "http://127.0.0.1:3000",
        "--file",
        ".env.local",
      ]),
    ).toEqual({
      environmentFile: resolve(process.cwd(), ".env.local"),
      site: {
        publicUrl: "http://127.0.0.1:3000",
        caddySite: "127.0.0.1",
        local: true,
      },
    });

    expect(() =>
      parseSiteConfigureArguments([
        "--url",
        "http://127.0.0.1:3000",
        "--file",
        ".env.local",
      ]),
    ).toThrow("Production --url must use HTTPS");
    expect(() =>
      parseSiteUrl("http://journal.example.com", { local: true }),
    ).toThrow("--local only permits");
    expect(() => parseSiteUrl("http://127.0.0.2", { local: true })).toThrow(
      "--local only permits",
    );
    expect(() => parseSiteUrl("http://127.1", { local: true })).toThrow(
      "--local only permits",
    );
  });

  it("accepts normalized punycode DNS labels without allowing dotenv syntax", () => {
    expect(parseSiteUrl("https://例子.测试")).toMatchObject({
      publicUrl: "https://xn--fsqu00a.xn--0zwm56d",
      caddySite: "xn--fsqu00a.xn--0zwm56d",
    });
  });
});

describe("site:configure environment updates", () => {
  it("updates exactly the three site variables while preserving comments, quotes, and unrelated values", () => {
    const contents = [
      "# Keep this comment exactly",
      "DATABASE_URL=postgresql://kept-user:kept-password@127.0.0.1:55432/darwin",
      'export CADDY_SITE = "old.example" # preserve this comment',
      "BETTER_AUTH_URL='https://old.example' # keep this too",
      "SITE_URL=https://old.example # and this",
      "UNRELATED=value",
      "",
    ].join("\r\n");

    expect(
      updateEnvironmentContents(contents, {
        caddySite: "journal.example.com",
        publicUrl: "https://journal.example.com",
      }),
    ).toEqual({
      changed: true,
      contents: [
        "# Keep this comment exactly",
        "DATABASE_URL=postgresql://kept-user:kept-password@127.0.0.1:55432/darwin",
        'export CADDY_SITE = "journal.example.com" # preserve this comment',
        "BETTER_AUTH_URL='https://journal.example.com' # keep this too",
        "SITE_URL=https://journal.example.com # and this",
        "UNRELATED=value",
        "",
      ].join("\r\n"),
    });
  });

  it("adds missing settings together in the documented order", () => {
    expect(
      updateEnvironmentContents("KEEP=value", {
        caddySite: "journal.example.com",
        publicUrl: "https://journal.example.com",
      }),
    ).toEqual({
      changed: true,
      contents:
        "KEEP=value\nCADDY_SITE=journal.example.com\nBETTER_AUTH_URL=https://journal.example.com\nSITE_URL=https://journal.example.com\n",
    });
  });

  it("writes only an explicit temporary fixture atomically with private permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "darwin-site-configure-"));
    const environmentFile = join(directory, "production.env");
    const original =
      "DATABASE_URL=postgresql://kept-user:kept-password@db:5432/darwin\nCADDY_SITE=old.example\n";

    try {
      await writeFile(environmentFile, original, {
        encoding: "utf8",
        mode: 0o644,
      });
      await chmod(environmentFile, 0o644);

      await writeSiteConfiguration(
        {
          caddySite: "journal.example.com",
          publicUrl: "https://journal.example.com",
        },
        { environmentFile },
      );

      expect(await readFile(environmentFile, "utf8")).toBe(
        "DATABASE_URL=postgresql://kept-user:kept-password@db:5432/darwin\nCADDY_SITE=journal.example.com\nBETTER_AUTH_URL=https://journal.example.com\nSITE_URL=https://journal.example.com\n",
      );
      expect((await stat(environmentFile)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid arguments before reading or changing the explicit fixture", async () => {
    const directory = await mkdtemp(join(tmpdir(), "darwin-site-configure-"));
    const environmentFile = join(directory, "production.env");
    const original = "CADDY_SITE=unchanged.example\nSECRET=kept-private\n";

    try {
      await writeFile(environmentFile, original, "utf8");

      await expect(
        main([
          "--url",
          "http://journal.example.com",
          "--file",
          environmentFile,
        ]),
      ).rejects.toThrow("Production --url must use HTTPS");
      await expect(
        main(["--url", "https://journal.example.com"]),
      ).rejects.toThrow("--file is required");
      expect(await readFile(environmentFile, "utf8")).toBe(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses a multiline quoted fixture without touching assignment-looking content inside it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "darwin-site-configure-"));
    const environmentFile = join(directory, "production.env");
    const original = [
      'PRIVATE_KEY="first line',
      "SITE_URL=https://must-not-be-treated-as-an-assignment.example",
      'last line"',
      "CADDY_SITE=unchanged.example",
      "",
    ].join("\n");

    try {
      await writeFile(environmentFile, original, "utf8");

      await expect(
        writeSiteConfiguration(
          {
            caddySite: "journal.example.com",
            publicUrl: "https://journal.example.com",
          },
          { environmentFile },
        ),
      ).rejects.toThrow("multiline quoted value");
      expect(await readFile(environmentFile, "utf8")).toBe(original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
