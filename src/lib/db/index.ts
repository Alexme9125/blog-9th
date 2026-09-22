import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from './schema';

const unconfiguredDatabaseUrl = 'postgres://darwin-unconfigured.invalid:5432/darwin';

export class DatabaseConfigurationError extends Error {
  constructor() {
    super('DATABASE_URL is not configured. Set DATABASE_URL before handling database-backed requests.');
    this.name = 'DatabaseConfigurationError';
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new DatabaseConfigurationError();
  }
}

// postgres.js opens a connection lazily. The unreachable fallback keeps imports safe during
// static builds; request handlers call assertDatabaseConfigured before issuing a query.
export const sql: Sql = postgres(process.env.DATABASE_URL?.trim() || unconfiguredDatabaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

export const db = drizzle({ client: sql, schema });

export { schema };
