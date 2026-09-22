import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as null | { mustChangePassword: boolean },
  upload: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({
  getSessionUserFromRequestHeaders: vi.fn(async () => state.user),
}));
vi.mock("@/lib/cms/media", () => ({
  getMedia: vi.fn(),
  uploadMedia: state.upload,
}));
import { POST } from "@/app/api/media/route";

beforeEach(() => {
  state.user = { mustChangePassword: false };
  state.upload
    .mockReset()
    .mockResolvedValue({ ok: true, data: { id: "fixture" } });
});

function request(origin: string | null, forwarded = false) {
  const headers: Record<string, string> = { host: "journal.example.com" };
  if (origin !== null) headers.origin = origin;
  if (forwarded) {
    headers.host = "app:3000";
    headers["x-forwarded-host"] = "journal.example.com";
    headers["x-forwarded-proto"] = "https";
  }
  const value = new Request(
    forwarded
      ? "http://app:3000/api/media"
      : "https://journal.example.com/api/media",
    {
      method: "POST",
      headers,
    },
  );
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
    expect((await POST(value)).status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "null",
    "https://untrusted.example.com",
    "https://journal.example.com.attacker.test",
    "https://journal.example.com/path",
  ])(
    "rejects missing or foreign origin %s even with a session",
    async (origin) => {
      const { value, parse } = request(origin);
      expect((await POST(value)).status).toBe(403);
      expect(parse).not.toHaveBeenCalled();
      expect(state.upload).not.toHaveBeenCalled();
    },
  );

  it("accepts a same-origin upload behind the configured HTTPS proxy", async () => {
    const { value, parse } = request("https://journal.example.com", true);
    expect((await POST(value)).status).toBe(201);
    expect(parse).toHaveBeenCalledOnce();
    expect(state.upload).toHaveBeenCalledOnce();
  });
});
