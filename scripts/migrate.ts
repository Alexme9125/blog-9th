import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

function loadLocalEnvironment(): void {
  if (process.env.DATABASE_URL || !existsSync(resolve(process.cwd(), '.env.local'))) {
    return;
  }

  process.loadEnvFile(resolve(process.cwd(), '.env.local'));
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle({ client: sql });

  try {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
    console.info('Database migrations are up to date.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration error.';
  console.error(`Migration failed: ${message}`);
  process.exitCode = 1;
});
