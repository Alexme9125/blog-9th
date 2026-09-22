import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

export const localDatabase = {
  host: "127.0.0.1",
  port: 55432,
  databaseName: "darwin",
  databaseUser: "darwin",
} as const;

export type ParsedEnvironment = {
  contents: string;
  values: Map<string, string>;
};

export type DatabaseUrlSetting = {
  present: boolean;
  value: string | undefined;
};

export type DatabaseConfiguration =
  | { kind: "missing" }
  | { kind: "local"; url: string }
  | { kind: "external"; url: string }
  | { kind: "invalid"; message: string };

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

export function parseEnvironment(contents: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u,
    );
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const trimmedValue = rawValue.trim();
    const isQuoted =
      (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
      (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"));
    const value = isQuoted
      ? trimmedValue.slice(1, -1)
      : trimmedValue.replace(/\s+#.*$/u, "").trim();

    values.set(key, value);
  }

  return values;
}

export async function readEnvironmentFile(
  environmentFile = resolve(process.cwd(), ".env.local"),
): Promise<ParsedEnvironment> {
  try {
    const contents = await readFile(environmentFile, "utf8");
    return { contents, values: parseEnvironment(contents) };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return { contents: "", values: new Map() };
    }

    throw error;
  }
}

export function configuredDatabaseUrl(
  environment: Record<string, string | undefined>,
  fileValues: ReadonlyMap<string, string>,
): DatabaseUrlSetting {
  if (Object.hasOwn(environment, "DATABASE_URL")) {
    return { present: true, value: environment.DATABASE_URL };
  }

  if (fileValues.has("DATABASE_URL")) {
    return { present: true, value: fileValues.get("DATABASE_URL") };
  }

  return { present: false, value: undefined };
}

export function classifyDatabaseUrl(
  setting: DatabaseUrlSetting,
): DatabaseConfiguration {
  if (!setting.present) {
    return { kind: "missing" };
  }

  const databaseUrl = setting.value?.trim();
  if (!databaseUrl) {
    return {
      kind: "invalid",
      message: "DATABASE_URL is configured but empty.",
    };
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return {
      kind: "invalid",
      message: "DATABASE_URL must be a valid PostgreSQL URL.",
    };
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return {
      kind: "invalid",
      message: "DATABASE_URL must use the PostgreSQL protocol.",
    };
  }

  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    return {
      kind: "invalid",
      message: "DATABASE_URL must contain valid URL-encoded credentials.",
    };
  }

  const urlPort = url.port === "" ? 5432 : Number(url.port);
  const isLocalDatabase =
    url.hostname === localDatabase.host &&
    urlPort === localDatabase.port &&
    username === localDatabase.databaseUser &&
    url.pathname === `/${localDatabase.databaseName}`;

  return isLocalDatabase
    ? { kind: "local", url: databaseUrl }
    : { kind: "external", url: databaseUrl };
}

export async function readDatabaseConfiguration(
  options: {
    environment?: Record<string, string | undefined>;
    environmentFile?: string;
  } = {},
): Promise<DatabaseConfiguration> {
  const environment = options.environment ?? process.env;
  const file = await readEnvironmentFile(options.environmentFile);
  return classifyDatabaseUrl(configuredDatabaseUrl(environment, file.values));
}

export function passwordFromLocalDatabaseUrl(databaseUrl: string): string {
  const configuration = classifyDatabaseUrl({
    present: true,
    value: databaseUrl,
  });
  if (configuration.kind !== "local") {
    throw new Error(
      "DATABASE_URL must point to darwin@127.0.0.1:55432/darwin.",
    );
  }

  let password: string;
  try {
    password = decodeURIComponent(new URL(configuration.url).password);
  } catch {
    throw new Error("DATABASE_URL must contain valid URL-encoded credentials.");
  }
  if (!password) {
    throw new Error(
      "DATABASE_URL for the local database must include a password.",
    );
  }

  return password;
}
