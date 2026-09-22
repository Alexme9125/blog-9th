import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { mustChangePassword: boolean },
  trustedOrigins: ["https://journal.example.com"],
  upload: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  getSessionUserFromRequestHeaders: vi.fn(async () => state.user),
  getTrustedRequestOrigins: vi.fn(async () => state.trustedOrigins),
}));
vi.mock("@/lib/cms/media", () => ({
  getMedia: vi.fn(),
  uploadMedia: state.upload,
}));
import { POST } from "@/app/api/media/route";

beforeEach(() => {
  state.user = { mustChangePassword: false };
  state.trustedOrigins = ["https://journal.example.com"];
  state.upload
    .mockReset()
    .mockResolvedValue({ ok: true, data: { id: "fixture" } });
});

function request(
  origin: string | null,
  overrides: Record<string, string | null | undefined> = {},
) {
  const headers = new Headers({
    host: "journal.example.com",
    "x-forwarded-proto": "https",
    "sec-fetch-site": "same-origin",
  });
  if (origin !== null) headers.set("origin", origin);
  for (const [name, value] of Object.entries(overrides)) {
    if (value == null) headers.delete(name);
    else headers.set(name, value);
  }
  const value = new Request("http://app:3000/api/media", {
    method: "POST",
    headers,
  });
  const parse = vi.spyOn(value, "formData").mockResolvedValue(new FormData());
  return { value, parse };
}

describe("media upload HTTP boundary", () => {
  it("rejects anonymous uploads before parsing multipart data", async () => {
    state.user = null;
    const { value, parse } = request("https://journal.example.com");
    expect((await POST(value)).status).toBe(401);
    expect(parse).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("rejects accounts pending password change before parsing", async () => {
    state.user = { mustChangePassword: true };
    const { value, parse } = request("https://journal.example.com");
    const response = await POST(value);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    expect(parse).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "null",
    "https://untrusted.example.com",
    "https://journal.example.com.attacker.test",
    "https://journal.example.com/path",
    "https://journal.example.com/",
    "https://journal.example.com?query=1",
    "https://journal.example.com#fragment",
    "https://user@journal.example.com",
    "https://journal.example.com, https://attacker.test",
    "ftp://journal.example.com",
    "http://journal.example.com",
    "https://journal.example.com:8443",
  ])(
    "rejects missing or foreign origin %s even with a session",
    async (origin) => {
      const { value, parse } = request(origin);
      const response = await POST(value);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
      expect(parse).not.toHaveBeenCalled();
      expect(state.upload).not.toHaveBeenCalled();
    },
  );

  it("does not disclose password-change status to an untrusted origin", async () => {
    state.user = { mustChangePassword: true };
    const { value, parse } = request("https://untrusted.example.com");
    const response = await POST(value);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    expect(parse).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("accepts a same-origin upload behind the configured HTTPS proxy", async () => {
    const { value, parse } = request("https://journal.example.com", {
      host: "app:3000",
      "x-forwarded-host": "journal.example.com",
    });
    expect((await POST(value)).status).toBe(201);
    expect(parse).toHaveBeenCalledOnce();
    expect(state.upload).toHaveBeenCalledOnce();
  });

  it.each([
    { "x-forwarded-proto": "http" },
    {
      host: "app:3000",
      "x-forwarded-host": "caddy:80",
      "x-forwarded-proto": "http",
    },
    {
      "x-forwarded-host": "journal.example.com, caddy:80",
      "x-forwarded-proto": "https, http",
    },
    { host: "journal.example.com:443" },
    { "x-forwarded-proto": null },
    { "sec-fetch-site": null, "x-forwarded-proto": "http" },
  ])(
    "accepts configured origins across proxy topologies: %j",
    async (overrides) => {
      const { value, parse } = request(
        "https://journal.example.com",
        overrides,
      );
      expect((await POST(value)).status).toBe(201);
      expect(parse).toHaveBeenCalledOnce();
      expect(state.upload).toHaveBeenCalledOnce();
    },
  );

  it("cannot expand the trusted origins with matching forged proxy headers", async () => {
    const { value, parse } = request("https://attacker.test", {
      host: "attacker.test",
      "x-forwarded-host": "attacker.test",
      "x-forwarded-proto": "https",
    });
    expect((await POST(value)).status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });

  it.each(["cross-site", "same-site", "none", "unknown"])(
    "rejects browser fetch metadata %s even from a configured origin",
    async (site) => {
      const { value, parse } = request("https://journal.example.com", {
        "sec-fetch-site": site,
      });
      expect((await POST(value)).status).toBe(403);
      expect(parse).not.toHaveBeenCalled();
      expect(state.upload).not.toHaveBeenCalled();
    },
  );

  it("uses the current explicit aliases including their port, and respects removal", async () => {
    const alias = "https://archive.example.com:8443";
    state.trustedOrigins.push(alias);
    expect((await POST(request(alias).value)).status).toBe(201);
    state.trustedOrigins = ["https://journal.example.com"];
    const { value, parse } = request(alias);
    expect((await POST(value)).status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
    expect(state.upload).toHaveBeenCalledOnce();
  });
});
