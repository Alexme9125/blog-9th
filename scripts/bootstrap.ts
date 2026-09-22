import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { hashPassword } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';

import type * as DatabaseSchema from '../src/lib/db/schema';

type BootstrapOptions = {
  demo: boolean;
  resetPassword: boolean;
};

function loadLocalEnvironment(): void {
  if (process.env.DATABASE_URL || !existsSync(resolve(process.cwd(), '.env.local'))) {
    return;
  }

  process.loadEnvFile(resolve(process.cwd(), '.env.local'));
}

function parseOptions(args: string[]): BootstrapOptions {
  const options: BootstrapOptions = { demo: false, resetPassword: false };

  for (const arg of args) {
    if (arg === '--demo') {
      options.demo = true;
      continue;
    }
    if (arg === '--reset-password') {
      options.resetPassword = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.info('Usage: bootstrap.ts [--demo] [--reset-password]');
      console.info('Use ADMIN_EMAIL, ADMIN_NAME, and ADMIN_PASSWORD, or answer the TTY prompts.');
      process.exit(0);
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

async function prompt(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(`Missing ${label.replace(/[:：]\s*$/u, '')}. Set the matching ADMIN_* environment variable.`);
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question(label)).trim();
  } finally {
    readline.close();
  }
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Missing administrator password. Set ADMIN_PASSWORD for a non-interactive run.');
  }

  process.stdout.write(label);

  return new Promise((resolvePromise, reject) => {
    let value = '';
    const input = process.stdin;
    const hadRawMode = input.isRaw;

    const cleanup = () => {
      input.off('data', onData);
      if (input.setRawMode) input.setRawMode(Boolean(hadRawMode));
      input.pause();
    };

    const finish = () => {
      cleanup();
      process.stdout.write('\n');
      resolvePromise(value);
    };

    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Bootstrap cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    if (input.setRawMode) input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    input.on('data', onData);
  });
}

async function readValue(environmentName: string, label: string): Promise<string> {
  const value = process.env[environmentName]?.trim();
  return value || prompt(label);
}

async function readPassword(): Promise<string> {
  const password = process.env.ADMIN_PASSWORD;
  if (password) return password;
  return promptSecret('管理员密码（至少 12 位）：');
}

function validateEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error('ADMIN_EMAIL must be a valid email address.');
  }
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new Error('Administrator password must be between 12 and 128 characters.');
  }
}

async function loadDatabaseSchema(): Promise<typeof DatabaseSchema> {
  // Node's built-in TypeScript runner requires the .ts suffix, while TypeScript's
  // project checker deliberately rejects literal .ts import specifiers. Building
  // the URL preserves both raw-Node bootstrap support and normal type checking.
  return import(new URL('../src/lib/db/schema.ts', import.meta.url).href) as Promise<typeof DatabaseSchema>;
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required. Run scripts/migrate.ts after configuring the database.');

  const schema = await loadDatabaseSchema();
  const { accounts, auditLog, sessions, users } = schema;

  const email = (await readValue('ADMIN_EMAIL', '管理员邮箱：')).toLowerCase();
  const name = await readValue('ADMIN_NAME', '管理员姓名：');
  validateEmail(email);
  if (!name || name.length > 120) throw new Error('Administrator name must be between 1 and 120 characters.');

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle({ client: sql, schema });

  const ensureCredentialPassword = async (userId: string, password: string): Promise<void> => {
    const passwordHash = await hashPassword(password);
    const [credential] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, userId),
          eq(accounts.providerId, 'credential'),
          eq(accounts.accountId, userId),
        ),
      )
      .limit(1);

    if (credential) {
      await db.update(accounts).set({ password: passwordHash, updatedAt: new Date() }).where(eq(accounts.id, credential.id));
      return;
    }

    await db.insert(accounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
    });
  };

  try {
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    let adminId: string;

    if (existing) {
      adminId = existing.id;
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ name, role: 'admin', disabled: false, emailVerified: true, mustChangePassword: false, updatedAt: new Date() })
          .where(eq(users.id, existing.id));
        await tx.delete(sessions).where(eq(sessions.userId, existing.id));
      });

      if (options.resetPassword) {
        const password = await readPassword();
        validatePassword(password);
        await ensureCredentialPassword(existing.id, password);
      }

      await db.insert(auditLog).values({
        actorId: existing.id,
        action: 'bootstrap.ensure_admin',
        resourceId: existing.id,
        detail: { passwordReset: options.resetPassword },
      });
      console.info(`Existing account ${email} is now an active administrator.`);
    } else {
      const password = await readPassword();
      validatePassword(password);
      adminId = randomUUID();
      const passwordHash = await hashPassword(password);

      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: adminId,
          name,
          email,
          emailVerified: true,
          role: 'admin',
          disabled: false,
          mustChangePassword: false,
        });
        await tx.insert(accounts).values({
          id: randomUUID(),
          accountId: adminId,
          providerId: 'credential',
          userId: adminId,
          password: passwordHash,
        });
        await tx.insert(auditLog).values({
          actorId: adminId,
          action: 'bootstrap.create_admin',
          resourceId: adminId,
          detail: {},
        });
      });

      console.info(`Created initial administrator account for ${email}.`);
    }

    if (options.demo) {
      const { seedDemoContent } = await import(new URL('../src/lib/cms/seed.ts', import.meta.url).href);
      await seedDemoContent({ adminId });
      console.info('Demo content was seeded.');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap error.';
  console.error(`Bootstrap failed: ${message}`);
  process.exitCode = 1;
});
