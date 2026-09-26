import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer, type Server, type TLSSocket } from "node:tls";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

type LocalSmtp = {
  server: Server;
  port: number;
  received: string[];
  authenticated: () => boolean;
  close: () => Promise<void>;
};

async function startLocalTlsSmtp(
  key: Buffer,
  cert: Buffer,
): Promise<LocalSmtp> {
  const received: string[] = [];
  const sockets = new Set<TLSSocket>();
  let authenticated = false;
  const server = createServer({ key, cert }, (socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 localhost Darwin test SMTP\r\n");

    let buffer = "";
    let readingData = false;
    const processInput = () => {
      while (buffer) {
        if (readingData) {
          const terminator = buffer.indexOf("\r\n.\r\n");
          if (terminator < 0) return;
          received.push(buffer.slice(0, terminator));
          buffer = buffer.slice(terminator + 5);
          readingData = false;
          socket.write("250 message accepted\r\n");
          continue;
        }

        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd < 0) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        if (/^EHLO /i.test(line)) {
          socket.write(
            "250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1048576\r\n",
          );
        } else if (/^AUTH /i.test(line)) {
          authenticated = true;
          socket.write("235 authentication succeeded\r\n");
        } else if (
          /^MAIL FROM:/i.test(line) ||
          /^RCPT TO:/i.test(line) ||
          /^RSET$/i.test(line)
        ) {
          socket.write("250 OK\r\n");
        } else if (/^DATA$/i.test(line)) {
          readingData = true;
          socket.write("354 end data with <CR><LF>.<CR><LF>\r\n");
        } else if (/^QUIT$/i.test(line)) {
          socket.end("221 bye\r\n");
        } else {
          socket.write("250 OK\r\n");
        }
      }
    };
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      processInput();
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    server,
    port: address.port,
    received,
    authenticated: () => authenticated,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      );
    },
  };
}

function runChild(
  script: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(
      process.execPath,
      [
        "--conditions=react-server",
        "--import=tsx",
        "--input-type=module",
        "--eval",
        script,
      ],
      { cwd: process.cwd(), env, stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectChild);
    child.once("close", (code) => resolveChild({ code, stderr }));
  });
}

describe("local TLS SMTP smoke", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it("delivers a test body to a trusted local TLS-only SMTP server without external network access", async () => {
    const directory = mkdtempSync(resolve(tmpdir(), "darwin-mail-tls-"));
    temporaryDirectories.push(directory);
    const keyPath = resolve(directory, "key.pem");
    const certificatePath = resolve(directory, "certificate.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certificatePath,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
    const smtp = await startLocalTlsSmtp(
      readFileSync(keyPath),
      readFileSync(certificatePath),
    );

    try {
      const transportPath = resolve(process.cwd(), "src/lib/mail/transport.ts");
      const script = `
        import { createSmtpTransport } from ${JSON.stringify(transportPath)};
        const transport = createSmtpTransport({
          host: '127.0.0.1', port: ${smtp.port}, security: 'tls',
          username: 'local-test-user', password: 'local-test-password',
          fromName: 'Darwin Journal', fromEmail: 'from@example.test', replyTo: ''
        });
        try {
          await transport.sendMail({
            from: { name: 'Darwin Journal', address: 'from@example.test' },
            to: 'to@example.test', subject: 'local TLS smoke', text: 'local-tls-smoke-body',
            messageId: '<local-tls-smoke@example.test>', disableFileAccess: true, disableUrlAccess: true
          });
        } finally {
          await transport.close?.();
        }
      `;
      const child = await runChild(script, {
        ...process.env,
        NODE_EXTRA_CA_CERTS: certificatePath,
      });
      expect(child.code, child.stderr).toBe(0);
      expect(smtp.authenticated()).toBe(true);
      expect(smtp.received.join("\n")).toContain("local-tls-smoke-body");
    } finally {
      await smtp.close();
    }
  }, 30_000);
});
