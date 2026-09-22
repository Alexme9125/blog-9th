import { describe, expect, it } from "vitest";
import { trustedAuthOrigins } from "@/lib/auth/origins";
import { loginErrorMessage } from "@/lib/auth/login-error";

describe("authentication origin boundaries", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "allows only same-protocol, same-port loopback aliases of %s in development",
    (host) => {
      expect(trustedAuthOrigins(`http://${host}:3000/api/auth`, false)).toEqual(
        ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"],
      );
    },
  );

  it("does not add local aliases or wildcard domains to production", () => {
    for (const host of ["darwin.example.test", "localhost", "127.0.0.1"])
      expect(trustedAuthOrigins(`https://${host}`, true)).toEqual([
        `https://${host}`,
      ]);
  });

  it("does not extend a remote development origin or trust lookalike hosts", () => {
    for (const host of [
      "dev.darwin.example.test",
      "localhost.example.test",
      "127.0.0.2",
    ])
      expect(trustedAuthOrigins(`https://${host}:4443`, false)).toEqual([
        `https://${host}:4443`,
      ]);
  });

  it("preserves non-default TLS ports for local development", () => {
    expect(trustedAuthOrigins("https://localhost:4443", false)).toEqual([
      "https://localhost:4443",
      "https://127.0.0.1:4443",
      "https://[::1]:4443",
    ]);
  });
});

describe("login failure feedback", () => {
  it("separates rejected origins from incorrect credentials without exposing account state", () => {
    expect(
      loginErrorMessage({ status: 403, code: "INVALID_ORIGIN" }),
    ).toContain("访问地址");
    expect(
      loginErrorMessage({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }),
    ).toContain("邮箱或密码");
    expect(
      loginErrorMessage({ status: 403, code: "FAILED_TO_CREATE_SESSION" }),
    ).toContain("邮箱或密码");
  });

  it("retains distinct rate-limit and service failure messages", () => {
    expect(loginErrorMessage({ status: 429 })).toContain("频繁");
    expect(loginErrorMessage({ status: 503 })).toContain("服务暂时不可用");
  });
});
