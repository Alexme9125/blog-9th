import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import {
  localDatabase,
  readDatabaseConfiguration,
  type DatabaseConfiguration,
} from "./dev-database-config";

const databaseReadyTimeoutMs = 30_000;
const databaseConfigurationTimeoutMs = 10_000;
const databaseHealthCheckIntervalMs = 1_000;
const childShutdownTimeoutMs = 5_000;

export type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

export type ManagedChild = Pick<
  ChildProcess,
  "exitCode" | "signalCode" | "once" | "kill"
>;

export type DatabaseHealthMonitor = {
  failed: Promise<void>;
  stop: () => void;
};

export type DevelopmentRuntime = {
  readDatabaseConfiguration: () => Promise<DatabaseConfiguration>;
  isLocalDatabasePortOpen: () => Promise<boolean>;
  startDatabase: () => ManagedChild;
  waitForSql: (url: string, signal: AbortSignal) => Promise<void>;
  startWeb: () => ManagedChild;
  startHealthMonitor: (url: string) => DatabaseHealthMonitor;
  stopDatabase: (child: ManagedChild) => Promise<void>;
  stopWeb: (child: ManagedChild) => Promise<void>;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  log: (message: string) => void;
  configurationTimeoutMs: number;
};

function hasExited(child: ManagedChild): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function waitForChildExit(child: ManagedChild): Promise<ChildExit> {
  if (hasExited(child)) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolvePromise) => {
    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
      error?: Error,
    ) => {
      resolvePromise({ code, signal, error });
    };

    child.once("exit", finish);
    child.once("error", (error) => finish(1, null, error));
  });
}

export function sleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(new Error("Development shutdown requested."));
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolvePromise();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error("Development shutdown requested."));
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function isLocalDatabasePortOpen(): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({
      host: localDatabase.host,
      port: localDatabase.port,
    });
    let settled = false;
    const finish = (isOpen: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolvePromise(isOpen);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

export async function probeSql(url: string): Promise<boolean> {
  let close: (() => Promise<void>) | undefined;

  try {
    const sql = postgres(url, {
      connect_timeout: 1,
      idle_timeout: 1,
      max: 1,
      prepare: false,
    });
    close = () => sql.end({ timeout: 1 });
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await close?.().catch(() => undefined);
  }
}

export async function waitForSql(
  url: string,
  signal: AbortSignal,
  timeoutMs = databaseReadyTimeoutMs,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!signal.aborted) {
    if (await probeSql(url)) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        "Configured PostgreSQL did not accept SQL connections within 30 seconds.",
      );
    }

    await sleep(Math.min(250, deadline - Date.now()), signal);
  }

  throw new Error("Development shutdown requested.");
}

export function startSqlHealthMonitor(
  url: string,
  options: {
    intervalMs?: number;
    probe?: (databaseUrl: string) => Promise<boolean>;
  } = {},
): DatabaseHealthMonitor {
  const intervalMs = options.intervalMs ?? databaseHealthCheckIntervalMs;
  const probe = options.probe ?? probeSql;
  let stopped = false;
  let timeout: NodeJS.Timeout | undefined;
  let fail: (() => void) | undefined;
  const failed = new Promise<void>((resolvePromise) => {
    fail = resolvePromise;
  });

  const scheduleProbe = () => {
    timeout = setTimeout(() => {
      void (async () => {
        if (stopped) {
          return;
        }

        let healthy = false;
        try {
          healthy = await probe(url);
        } catch {
          healthy = false;
        }

        if (!healthy) {
          fail?.();
          return;
        }

        if (stopped) {
          return;
        }

        scheduleProbe();
      })();
    }, intervalMs);
  };

  scheduleProbe();

  return {
    failed,
    stop: () => {
      stopped = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    },
  };
}

function databaseExitBeforeReady(exit: ChildExit): Error {
  const suffix = exit.error ? "could not be started" : "stopped";
  return new Error(
    `The local PostgreSQL process ${suffix} before it accepted SQL connections.`,
  );
}

export class DevelopmentLifecycle {
  private readonly abortController = new AbortController();
  private cleanupPromise: Promise<void> | undefined;
  private databaseChild: ManagedChild | undefined;
  private databaseExit: Promise<ChildExit> | undefined;
  private databaseWasStarted = false;
  private healthMonitor: DatabaseHealthMonitor | undefined;
  private stopping = false;
  private webChild: ManagedChild | undefined;
  private webExit: Promise<ChildExit> | undefined;

  constructor(private readonly runtime: DevelopmentRuntime) {}

  async run(): Promise<number> {
    try {
      const configuration = await this.prepareDatabase();
      if (this.stopping) {
        return 0;
      }

      this.runtime.log(
        configuration.kind === "local"
          ? "Waiting for local PostgreSQL to accept SQL connections…"
          : "Waiting for configured PostgreSQL to accept SQL connections…",
      );
      await this.waitForDatabaseReady(configuration.url);
      if (this.stopping) {
        return 0;
      }

      this.runtime.log("Starting Next.js development server.");
      this.webChild = this.runtime.startWeb();
      this.webExit = waitForChildExit(this.webChild);
      this.healthMonitor = this.runtime.startHealthMonitor(configuration.url);

      const events: Array<
        Promise<{ kind: "database" | "health" | "web"; exit?: ChildExit }>
      > = [
        this.webExit.then((exit) => ({ kind: "web", exit })),
        this.healthMonitor.failed.then(() => ({ kind: "health" })),
      ];
      if (this.databaseWasStarted && this.databaseExit) {
        events.push(
          this.databaseExit.then((exit) => ({ kind: "database", exit })),
        );
      }

      const event = await Promise.race(events);
      if (this.stopping) {
        return 0;
      }

      if (event.kind === "web") {
        await this.cleanup();
        return event.exit?.code === 0 ? 0 : 1;
      }

      this.runtime.log(
        "PostgreSQL is no longer accepting SQL connections; stopping Next.js.",
      );
      await this.cleanup();
      return 1;
    } catch (error) {
      await this.cleanup();
      if (this.stopping) {
        return 0;
      }

      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.abortController.abort();
    await this.cleanup();
  }

  private async prepareDatabase(): Promise<
    Extract<DatabaseConfiguration, { url: string }>
  > {
    let configuration = await this.runtime.readDatabaseConfiguration();
    this.assertValidConfiguration(configuration);

    if (configuration.kind === "missing") {
      this.runtime.log("Starting project-local PostgreSQL.");
      this.startDatabase();
      configuration = await this.waitForDatabaseConfiguration();
    } else if (configuration.kind === "local") {
      if (!(await this.runtime.isLocalDatabasePortOpen())) {
        this.runtime.log("Starting project-local PostgreSQL.");
        this.startDatabase();
      } else {
        this.runtime.log("Reusing local PostgreSQL at 127.0.0.1:55432.");
      }
    } else if (configuration.kind === "external") {
      this.runtime.log("Using the configured PostgreSQL database.");
    }

    this.assertValidConfiguration(configuration);
    if (configuration.kind === "missing") {
      throw new Error("A local DATABASE_URL was not created in time.");
    }

    return configuration;
  }

  private startDatabase(): void {
    if (this.stopping) {
      return;
    }

    this.databaseChild = this.runtime.startDatabase();
    this.databaseExit = waitForChildExit(this.databaseChild);
    this.databaseWasStarted = true;
  }

  private async waitForDatabaseConfiguration(): Promise<DatabaseConfiguration> {
    const deadline = Date.now() + this.runtime.configurationTimeoutMs;

    while (!this.abortController.signal.aborted) {
      const configuration = await this.runtime.readDatabaseConfiguration();
      this.assertValidConfiguration(configuration);
      if (configuration.kind !== "missing") {
        return configuration;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          "A local DATABASE_URL was not created within 10 seconds.",
        );
      }

      await this.raceDatabaseExit(
        this.runtime.sleep(100, this.abortController.signal),
      );
    }

    throw new Error("Development shutdown requested.");
  }

  private async waitForDatabaseReady(url: string): Promise<void> {
    await this.raceDatabaseExit(
      this.runtime.waitForSql(url, this.abortController.signal),
    );
  }

  private async raceDatabaseExit<T>(operation: Promise<T>): Promise<T> {
    if (!this.databaseExit) {
      return operation;
    }

    return Promise.race([
      operation,
      this.databaseExit.then((exit) => {
        throw databaseExitBeforeReady(exit);
      }),
    ]);
  }

  private assertValidConfiguration(
    configuration: DatabaseConfiguration,
  ): asserts configuration is Exclude<
    DatabaseConfiguration,
    { kind: "invalid" }
  > {
    if (configuration.kind === "invalid") {
      throw new Error(configuration.message);
    }
  }

  private async cleanup(): Promise<void> {
    if (this.cleanupPromise) {
      return this.cleanupPromise;
    }

    this.cleanupPromise = (async () => {
      this.healthMonitor?.stop();
      if (this.webChild) {
        await this.runtime.stopWeb(this.webChild);
      }
      if (this.databaseWasStarted && this.databaseChild) {
        await this.runtime.stopDatabase(this.databaseChild);
      }
    })();

    return this.cleanupPromise;
  }
}

async function waitForExitAfterShutdown(child: ManagedChild): Promise<void> {
  if (hasExited(child)) {
    return;
  }

  await Promise.race([
    waitForChildExit(child),
    sleep(childShutdownTimeoutMs).catch(() => undefined),
  ]);
}

async function stopWeb(child: ManagedChild): Promise<void> {
  if (hasExited(child)) {
    return;
  }

  child.kill("SIGTERM");
  await waitForExitAfterShutdown(child);
}

async function stopDatabase(child: ManagedChild): Promise<void> {
  if (hasExited(child)) {
    return;
  }

  const childWithIpc = child as ChildProcess;
  if (childWithIpc.connected && childWithIpc.send) {
    try {
      childWithIpc.send({ type: "shutdown" });
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }

  await waitForExitAfterShutdown(child);
  if (!hasExited(child)) {
    child.kill("SIGTERM");
    await waitForExitAfterShutdown(child);
  }
}

function startDatabase(): ChildProcess {
  return spawn(
    process.execPath,
    ["--import", "tsx", resolve(process.cwd(), "scripts/dev-db.ts")],
    {
      cwd: process.cwd(),
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    },
  );
}

function startWeb(nextArguments: string[]): ChildProcess {
  return spawn(
    process.execPath,
    [
      resolve(process.cwd(), "node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      ...nextArguments,
    ],
    { cwd: process.cwd(), stdio: "inherit" },
  );
}

function createRuntime(nextArguments: string[]): DevelopmentRuntime {
  return {
    readDatabaseConfiguration,
    isLocalDatabasePortOpen,
    startDatabase,
    waitForSql,
    startWeb: () => startWeb(nextArguments),
    startHealthMonitor: startSqlHealthMonitor,
    stopDatabase,
    stopWeb,
    sleep: (milliseconds, signal) => sleep(milliseconds, signal),
    log: (message) => console.info(message),
    configurationTimeoutMs: databaseConfigurationTimeoutMs,
  };
}

async function main(): Promise<void> {
  const lifecycle = new DevelopmentLifecycle(
    createRuntime(process.argv.slice(2)),
  );
  let receivedSignal: NodeJS.Signals | undefined;
  const stopForSignal = (signal: NodeJS.Signals) => {
    receivedSignal ??= signal;
    void lifecycle.stop();
  };
  const onSigint = () => stopForSignal("SIGINT");
  const onSigterm = () => stopForSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const exitCode = await lifecycle.run();
    process.exitCode = receivedSignal
      ? receivedSignal === "SIGINT"
        ? 130
        : 143
      : exitCode;
  } catch {
    console.error(
      "Could not start the development environment. Check DATABASE_URL and local PostgreSQL setup.",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await lifecycle.stop();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main();
}
