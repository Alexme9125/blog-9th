import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  classifyDatabaseUrl,
  configuredDatabaseUrl,
  type DatabaseConfiguration,
} from "../scripts/dev-database-config";
import {
  DevelopmentLifecycle,
  startSqlHealthMonitor,
  type DatabaseHealthMonitor,
  type DevelopmentRuntime,
  type ManagedChild,
} from "../scripts/dev";

const localUrl = "postgresql://darwin:local-password@127.0.0.1:55432/darwin";
const externalUrl =
  "postgresql://darwin:external-password@database.example.test:5432/darwin";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    this.exit(null, signal);
    return true;
  });

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) {
      return;
    }

    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  asManagedChild(): ManagedChild {
    return this as unknown as ManagedChild;
  }
}

function controlledHealthMonitor(): {
  monitor: DatabaseHealthMonitor;
  fail: () => void;
} {
  const failure = deferred<void>();
  return {
    monitor: { failed: failure.promise, stop: vi.fn() },
    fail: () => failure.resolve(),
  };
}

function developmentRuntime(
  configuration: DatabaseConfiguration,
  overrides: Partial<DevelopmentRuntime> = {},
): DevelopmentRuntime {
  return {
    readDatabaseConfiguration: async () => configuration,
    isLocalDatabasePortOpen: async () => true,
    startDatabase: () => new FakeChild().asManagedChild(),
    waitForSql: async () => undefined,
    startWeb: () => new FakeChild().asManagedChild(),
    startHealthMonitor: () => controlledHealthMonitor().monitor,
    stopDatabase: async () => undefined,
    stopWeb: async () => undefined,
    sleep: async () => undefined,
    log: () => undefined,
    configurationTimeoutMs: 10,
    ...overrides,
  };
}

describe("development database configuration", () => {
  it("treats only the project endpoint as a managed local database", () => {
    expect(classifyDatabaseUrl({ present: true, value: localUrl })).toEqual({
      kind: "local",
      url: localUrl,
    });
    expect(classifyDatabaseUrl({ present: true, value: externalUrl })).toEqual({
      kind: "external",
      url: externalUrl,
    });
  });

  it("keeps an explicit shell DATABASE_URL ahead of .env.local", () => {
    expect(
      configuredDatabaseUrl(
        { DATABASE_URL: externalUrl },
        new Map([["DATABASE_URL", localUrl]]),
      ),
    ).toEqual({ present: true, value: externalUrl });
  });

  it("rejects malformed URL-encoded local credentials without treating them as local", () => {
    expect(
      classifyDatabaseUrl({
        present: true,
        value: "postgresql://darwin%ZZ:password@127.0.0.1:55432/darwin",
      }),
    ).toMatchObject({ kind: "invalid" });
  });
});

describe("development lifecycle", () => {
  it("treats a failed SQL health probe as a database failure", async () => {
    vi.useFakeTimers();
    try {
      const monitor = startSqlHealthMonitor(externalUrl, {
        intervalMs: 1,
        probe: async () => {
          throw new Error("connection lost");
        },
      });

      await vi.advanceTimersByTimeAsync(1);
      await expect(monitor.failed).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for SQL readiness before starting Next.js", async () => {
    const databaseReady = deferred<void>();
    const webStarted = deferred<void>();
    const web = new FakeChild();
    const health = controlledHealthMonitor();
    const startWeb = vi.fn(() => {
      webStarted.resolve();
      return web.asManagedChild();
    });
    const runtime = developmentRuntime(
      { kind: "local", url: localUrl },
      {
        waitForSql: () => databaseReady.promise,
        startWeb,
        startHealthMonitor: () => health.monitor,
      },
    );
    const lifecycle = new DevelopmentLifecycle(runtime);
    const run = lifecycle.run();

    await Promise.resolve();
    expect(startWeb).not.toHaveBeenCalled();
    databaseReady.resolve();
    await webStarted.promise;
    web.exit(0);

    await expect(run).resolves.toBe(0);
  });

  it("uses an external database without starting or stopping a local process", async () => {
    const webStarted = deferred<void>();
    const web = new FakeChild();
    const health = controlledHealthMonitor();
    const startDatabase = vi.fn(() => new FakeChild().asManagedChild());
    const stopDatabase = vi.fn(async () => undefined);
    const runtime = developmentRuntime(
      { kind: "external", url: externalUrl },
      {
        isLocalDatabasePortOpen: async () => {
          throw new Error("an external URL must not inspect the local port");
        },
        startDatabase,
        startWeb: () => {
          webStarted.resolve();
          return web.asManagedChild();
        },
        startHealthMonitor: () => health.monitor,
        stopDatabase,
      },
    );
    const lifecycle = new DevelopmentLifecycle(runtime);
    const run = lifecycle.run();

    await webStarted.promise;
    web.exit(0);

    await expect(run).resolves.toBe(0);
    expect(startDatabase).not.toHaveBeenCalled();
    expect(stopDatabase).not.toHaveBeenCalled();
  });

  it("stops Next.js and its own database child after database health fails", async () => {
    const database = new FakeChild();
    const web = new FakeChild();
    const webStarted = deferred<void>();
    const health = controlledHealthMonitor();
    const stopWeb = vi.fn(async (child: ManagedChild) => {
      (child as unknown as FakeChild).exit(null, "SIGTERM");
    });
    const stopDatabase = vi.fn(async (child: ManagedChild) => {
      (child as unknown as FakeChild).exit(null, "SIGTERM");
    });
    const runtime = developmentRuntime(
      { kind: "local", url: localUrl },
      {
        isLocalDatabasePortOpen: async () => false,
        startDatabase: () => database.asManagedChild(),
        startWeb: () => {
          webStarted.resolve();
          return web.asManagedChild();
        },
        startHealthMonitor: () => health.monitor,
        stopWeb,
        stopDatabase,
      },
    );
    const lifecycle = new DevelopmentLifecycle(runtime);
    const run = lifecycle.run();

    await webStarted.promise;
    health.fail();

    await expect(run).resolves.toBe(1);
    expect(stopWeb).toHaveBeenCalledWith(web.asManagedChild());
    expect(stopDatabase).toHaveBeenCalledWith(database.asManagedChild());
  });

  it("does not stop a reused local database when Next.js exits", async () => {
    const webStarted = deferred<void>();
    const web = new FakeChild();
    const health = controlledHealthMonitor();
    const startDatabase = vi.fn(() => new FakeChild().asManagedChild());
    const stopDatabase = vi.fn(async () => undefined);
    const runtime = developmentRuntime(
      { kind: "local", url: localUrl },
      {
        startDatabase,
        startWeb: () => {
          webStarted.resolve();
          return web.asManagedChild();
        },
        startHealthMonitor: () => health.monitor,
        stopDatabase,
      },
    );
    const lifecycle = new DevelopmentLifecycle(runtime);
    const run = lifecycle.run();

    await webStarted.promise;
    web.exit(0);

    await expect(run).resolves.toBe(0);
    expect(startDatabase).not.toHaveBeenCalled();
    expect(stopDatabase).not.toHaveBeenCalled();
  });

  it("does not leave Next.js running when its new database process exits during startup", async () => {
    const database = new FakeChild();
    const databaseReady = deferred<void>();
    const startWeb = vi.fn(() => new FakeChild().asManagedChild());
    const runtime = developmentRuntime(
      { kind: "local", url: localUrl },
      {
        isLocalDatabasePortOpen: async () => false,
        startDatabase: () => database.asManagedChild(),
        waitForSql: () => databaseReady.promise,
        startWeb,
      },
    );
    const lifecycle = new DevelopmentLifecycle(runtime);
    const run = lifecycle.run();

    await Promise.resolve();
    database.exit(1);

    await expect(run).rejects.toThrow(
      "The local PostgreSQL process stopped before it accepted SQL connections.",
    );
    expect(startWeb).not.toHaveBeenCalled();
  });
});
