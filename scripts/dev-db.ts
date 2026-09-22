import { access, appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";

import {
  configuredDatabaseUrl,
  localDatabase,
  passwordFromLocalDatabaseUrl,
  readEnvironmentFile,
} from "./dev-database-config";

const { host, port, databaseName, databaseUser } = localDatabase;
const dataDirectory = resolve(process.cwd(), ".data", "postgres");
const environmentFile = resolve(process.cwd(), ".env.local");

type DatabaseCredentials = {
  password: string;
  createdEnvironmentFileEntry: boolean;
};

let postgres: EmbeddedPostgres | undefined;
let shutdownRequested = false;
let shutdownPromise: Promise<void> | undefined;
let foregroundDone: (() => void) | undefined;
let healthMonitor: NodeJS.Timeout | undefined;
let healthCheckInFlight = false;
let databaseStoppedUnexpectedly = false;

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function loadCredentials(): Promise<DatabaseCredentials> {
  const environment = await readEnvironmentFile(environmentFile);
  const databaseUrl = configuredDatabaseUrl(process.env, environment.values);

  if (databaseUrl.present) {
    if (!databaseUrl.value?.trim()) {
      throw new Error("DATABASE_URL is configured but empty.");
    }

    return {
      password: passwordFromLocalDatabaseUrl(databaseUrl.value),
      createdEnvironmentFileEntry: false,
    };
  }

  const password = randomBytes(24).toString("base64url");
  const databaseUrlForFile = `postgresql://${databaseUser}:${password}@${host}:${port}/${databaseName}`;
  const separator =
    environment.contents.length === 0 || environment.contents.endsWith("\n")
      ? ""
      : "\n";
  const entry = `${separator}# Local development PostgreSQL (managed by scripts/dev-db.ts)\nDATABASE_URL=${databaseUrlForFile}\n`;

  await appendFile(environmentFile, entry, { encoding: "utf8", mode: 0o600 });
  await chmod(environmentFile, 0o600);

  return { password, createdEnvironmentFileEntry: true };
}

async function isClusterInitialised(): Promise<boolean> {
  try {
    await access(resolve(dataDirectory, "PG_VERSION"), constants.F_OK);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

async function assertPortIsAvailable(): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const server = createServer();
    const close = () =>
      server.close((error) => (error ? reject(error) : resolvePromise()));

    server.once("error", reject);
    server.listen({ host, port, exclusive: true }, close);
  });
}

async function assertNoRunningCluster(): Promise<void> {
  let pidFile: string;

  try {
    pidFile = await readFile(resolve(dataDirectory, "postmaster.pid"), "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return;
    }

    throw error;
  }

  const pid = Number.parseInt(pidFile.split(/\r?\n/u)[0] ?? "", 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, 0);
    throw new Error(
      "A PostgreSQL process already owns .data/postgres; refusing to start another one.",
    );
  } catch (error) {
    if (isNodeError(error, "EPERM")) {
      throw new Error(
        "A PostgreSQL process already owns .data/postgres; refusing to start another one.",
      );
    }

    if (!isNodeError(error, "ESRCH")) {
      throw error;
    }
  }
}

async function ensureDatabaseExists(instance: EmbeddedPostgres): Promise<void> {
  const client = instance.getPgClient("postgres", host);

  try {
    await client.connect();
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName],
    );
    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

function stopHealthMonitor(): void {
  if (healthMonitor) {
    clearInterval(healthMonitor);
    healthMonitor = undefined;
  }
}

async function checkLocalDatabaseHealth(): Promise<void> {
  const instance = postgres;
  if (!instance || shutdownRequested || healthCheckInFlight) {
    return;
  }

  healthCheckInFlight = true;
  const client = instance.getPgClient(databaseName, host);

  try {
    await client.connect();
    await client.query("SELECT 1");
  } catch {
    if (!shutdownRequested && postgres === instance) {
      databaseStoppedUnexpectedly = true;
      postgres = undefined;
      stopHealthMonitor();
      console.error("Local PostgreSQL stopped unexpectedly.");
      foregroundDone?.();
    }
  } finally {
    await client.end().catch(() => undefined);
    healthCheckInFlight = false;
  }
}

function startHealthMonitor(): void {
  healthMonitor = setInterval(() => {
    void checkLocalDatabaseHealth();
  }, 1_000);
}

async function stopDatabase(signal: string): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownRequested = true;
  shutdownPromise = (async () => {
    try {
      stopHealthMonitor();
      if (postgres) {
        console.info(`Stopping local PostgreSQL (${signal})…`);
        await postgres.stop();
      }
    } finally {
      foregroundDone?.();
    }
  })();

  return shutdownPromise;
}

function installSignalHandlers(): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stopDatabase(signal).catch(() => {
        process.exitCode = 1;
      });
    });
  }
}

function installIpcHandlers(): void {
  process.on("message", (message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      message.type !== "shutdown"
    ) {
      return;
    }

    void stopDatabase("development launcher").catch(() => {
      process.exitCode = 1;
    });
  });

  process.once("disconnect", () => {
    void stopDatabase("development launcher disconnected").catch(() => {
      process.exitCode = 1;
    });
  });
}

async function run(): Promise<void> {
  installSignalHandlers();
  installIpcHandlers();

  await assertNoRunningCluster();
  await assertPortIsAvailable();
  const credentials = await loadCredentials();

  postgres = new EmbeddedPostgres({
    databaseDir: dataDirectory,
    port,
    user: databaseUser,
    password: credentials.password,
    authMethod: "scram-sha-256",
    persistent: true,
    createPostgresUser: false,
    postgresFlags: ["-c", `listen_addresses=${host}`],
    onLog: () => undefined,
    onError: () => undefined,
  });

  if (!(await isClusterInitialised())) {
    await mkdir(dirname(dataDirectory), { recursive: true });
    await postgres.initialise();
  }

  if (shutdownRequested) {
    await stopDatabase("shutdown request");
    return;
  }

  await postgres.start();
  if (shutdownRequested) {
    await stopDatabase("shutdown request");
    return;
  }

  await ensureDatabaseExists(postgres);

  if (credentials.createdEnvironmentFileEntry) {
    console.info("Created a local DATABASE_URL in .env.local.");
  }
  console.info(
    "Local PostgreSQL is running at 127.0.0.1:55432 (database: darwin).",
  );
  console.info("Press Ctrl+C to stop it.");

  const foreground = new Promise<void>((resolvePromise) => {
    foregroundDone = resolvePromise;
    if (shutdownRequested) {
      resolvePromise();
    }
  });
  startHealthMonitor();
  await foreground;

  if (databaseStoppedUnexpectedly) {
    throw new Error("Local PostgreSQL stopped unexpectedly.");
  }
}

void run()
  .catch(async () => {
    await stopDatabase("startup failure").catch(() => undefined);
    if (!databaseStoppedUnexpectedly) {
      console.error(
        "Could not start local PostgreSQL. Verify .env.local and run pnpm rebuild @embedded-postgres/darwin-arm64 before trying again.",
      );
    }
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.connected && process.disconnect) {
      process.disconnect();
    }
  });
