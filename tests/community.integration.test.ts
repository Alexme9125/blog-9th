import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminUser, DocumentData } from '@/lib/cms/types';
import * as schema from '@/lib/db/schema';

const runId = randomUUID().replaceAll('-', '');
const testDatabaseName = `darwin_community_test_${runId}`;
const publicOrigin = 'http://127.0.0.1:3000';
const mutableEnvironment = process.env as Record<string, string | undefined>;
const originalEnvironment = {
  databaseUrl: process.env.DATABASE_URL,
  siteUrl: process.env.SITE_URL,
  betterAuthUrl: process.env.BETTER_AUTH_URL,
  nodeEnv: process.env.NODE_ENV,
  trustedIpHeader: process.env.COMMUNITY_TRUSTED_IP_HEADER,
  trustedIpProof: process.env.COMMUNITY_TRUSTED_IP_PROOF,
};

function configuredDatabaseUrl(): string | undefined {
  if (!process.env.DATABASE_URL && existsSync(resolve(process.cwd(), '.env.local'))) {
    process.loadEnvFile(resolve(process.cwd(), '.env.local'));
  }
  return process.env.DATABASE_URL?.trim() || undefined;
}

function databaseUrlFor(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

const sourceDatabaseUrl = configuredDatabaseUrl();
const databaseDescribe = sourceDatabaseUrl ? describe : describe.skip;

function actionError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

const admin: AdminUser = {
  id: `community-admin-${runId}`,
  name: 'Community Test Admin',
  email: `community-admin-${runId}@example.test`,
  role: 'admin',
  disabled: false,
  mustChangePassword: false,
};
const editor: AdminUser = {
  id: `community-editor-${runId}`,
  name: 'Community Test Editor',
  email: `community-editor-${runId}@example.test`,
  role: 'editor',
  disabled: false,
  mustChangePassword: false,
};

let currentUser: AdminUser | null = null;
let requestHeaders = new Headers({ origin: publicOrigin, 'sec-fetch-site': 'same-origin' });

async function requireCurrentUser(): Promise<AdminUser> {
  if (!currentUser) throw actionError('UNAUTHENTICATED');
  return currentUser;
}

async function requireCurrentRole(roles: AdminUser['role'][]): Promise<AdminUser> {
  const user = await requireCurrentUser();
  if (!roles.includes(user.role)) throw actionError('FORBIDDEN');
  return user;
}

async function requireCurrentMutationUser(roles?: AdminUser['role'][]): Promise<AdminUser> {
  const user = roles ? await requireCurrentRole(roles) : await requireCurrentUser();
  if (user.mustChangePassword) throw actionError('PASSWORD_CHANGE_REQUIRED');
  return user;
}

function formPost(slug: string, title: string): DocumentData {
  return {
    slug,
    title,
    excerpt: `${title} 摘要`,
    coverUrl: null,
    coverAlt: '',
    categoryId: null,
    tagIds: [],
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${title} 正文` }] }] },
    blocks: [],
    description: `${title} 描述`,
    featured: false,
  };
}

function tokenFromText(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error('Expected an opaque token in the mail text.');
  return match[1]!;
}

databaseDescribe('community database integration', () => {
  let controlSql: Sql | undefined;
  let testSql: Sql | undefined;
  let serviceSql: Sql | undefined;
  let testDb: ReturnType<typeof drizzle<typeof schema>>;
  let actions: typeof import('@/lib/community/actions');
  let adminActions: typeof import('@/lib/community/admin');
  let documentsService: typeof import('@/lib/cms/documents');
  let publication: typeof import('@/lib/community/publication');

  const requireTestDb = () => {
    if (!testDb) throw new Error('Test database was not initialized.');
    return testDb;
  };

  async function setMailConfiguration(input: Partial<typeof schema.mailSettings.$inferInsert> = {}): Promise<void> {
    await requireTestDb()
      .insert(schema.mailSettings)
      .values({
        id: 'default',
        enabled: true,
        host: 'smtp.example.test',
        port: 587,
        security: 'starttls',
        username: 'mailer@example.test',
        passwordEncrypted: 'test-only-not-used-by-queue',
        fromName: 'Darwin',
        fromEmail: 'mailer@example.test',
        replyTo: '',
        applicationRecipient: 'club@example.test',
        notifyOnPublish: true,
        allowManualPush: true,
        ...input,
      })
      .onConflictDoUpdate({ target: schema.mailSettings.id, set: { ...input, updatedAt: new Date() } });
  }

  async function insertConfirmedSubscriber(email: string): Promise<string> {
    const [subscriber] = await requireTestDb()
      .insert(schema.communitySubscribers)
      .values({ email, status: 'confirmed', consentAt: new Date(), confirmedAt: new Date() })
      .returning({ id: schema.communitySubscribers.id });
    if (!subscriber) throw new Error('Could not create subscriber.');
    return subscriber.id;
  }

  beforeAll(async () => {
    if (!sourceDatabaseUrl) throw new Error('DATABASE_URL is required for community integration tests.');
    controlSql = postgres(databaseUrlFor(sourceDatabaseUrl, 'postgres'), { max: 1, prepare: false });
    await controlSql.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    const testDatabaseUrl = databaseUrlFor(sourceDatabaseUrl, testDatabaseName);
    testSql = postgres(testDatabaseUrl, { max: 1, prepare: false });
    testDb = drizzle({ client: testSql, schema });
    await migrate(testDb, { migrationsFolder: resolve(process.cwd(), 'drizzle') });

    mutableEnvironment.DATABASE_URL = testDatabaseUrl;
    mutableEnvironment.SITE_URL = publicOrigin;
    mutableEnvironment.BETTER_AUTH_URL = publicOrigin;
    mutableEnvironment.NODE_ENV = 'test';
    delete mutableEnvironment.COMMUNITY_TRUSTED_IP_HEADER;
    delete mutableEnvironment.COMMUNITY_TRUSTED_IP_PROOF;

    vi.doMock('@/lib/auth/server', () => ({
      getTrustedRequestOrigins: async () => [publicOrigin],
      requireRole: requireCurrentRole,
      requireMutationUser: requireCurrentMutationUser,
      requireUser: requireCurrentUser,
    }));
    vi.doMock('next/headers', () => ({ headers: async () => requestHeaders }));
    vi.resetModules();

    const [database, actionModule, adminModule, documentModule, publicationModule] = await Promise.all([
      import('@/lib/db'),
      import('@/lib/community/actions'),
      import('@/lib/community/admin'),
      import('@/lib/cms/documents'),
      import('@/lib/community/publication'),
    ]);
    serviceSql = database.sql;
    actions = actionModule;
    adminActions = adminModule;
    documentsService = documentModule;
    publication = publicationModule;

    await requireTestDb().insert(schema.users).values([
      { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      { id: editor.id, name: editor.name, email: editor.email, role: editor.role },
    ]);
    await setMailConfiguration();
  });

  beforeEach(async () => {
    currentUser = admin;
    requestHeaders = new Headers({ origin: publicOrigin, 'sec-fetch-site': 'same-origin' });
    // Keep individual flows independent inside the disposable database. In particular, a manual
    // push's recipient count must not inherit confirmed subscribers from a prior test case.
    await requireTestDb().delete(schema.mailJobs);
    await requireTestDb().delete(schema.communityActionTokens);
    await requireTestDb().delete(schema.communityApplications);
    await requireTestDb().delete(schema.communitySubscribers);
    await requireTestDb().delete(schema.communityRateLimits);
    await setMailConfiguration({ enabled: true, applicationRecipient: 'club@example.test', notifyOnPublish: true, allowManualPush: true });
  });

  afterAll(async () => {
    currentUser = null;
    if (serviceSql) await serviceSql.end({ timeout: 5 });
    if (testSql) await testSql.end({ timeout: 5 });
    if (controlSql) {
      await controlSql.unsafe(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
      await controlSql.end({ timeout: 5 });
    }
    if (originalEnvironment.databaseUrl === undefined) delete mutableEnvironment.DATABASE_URL;
    else mutableEnvironment.DATABASE_URL = originalEnvironment.databaseUrl;
    if (originalEnvironment.siteUrl === undefined) delete mutableEnvironment.SITE_URL;
    else mutableEnvironment.SITE_URL = originalEnvironment.siteUrl;
    if (originalEnvironment.betterAuthUrl === undefined) delete mutableEnvironment.BETTER_AUTH_URL;
    else mutableEnvironment.BETTER_AUTH_URL = originalEnvironment.betterAuthUrl;
    if (originalEnvironment.nodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = originalEnvironment.nodeEnv;
    if (originalEnvironment.trustedIpHeader === undefined) delete mutableEnvironment.COMMUNITY_TRUSTED_IP_HEADER;
    else mutableEnvironment.COMMUNITY_TRUSTED_IP_HEADER = originalEnvironment.trustedIpHeader;
    if (originalEnvironment.trustedIpProof === undefined) delete mutableEnvironment.COMMUNITY_TRUSTED_IP_PROOF;
    else mutableEnvironment.COMMUNITY_TRUSTED_IP_PROOF = originalEnvironment.trustedIpProof;
    vi.doUnmock('@/lib/auth/server');
    vi.doUnmock('next/headers');
    vi.resetModules();
  });

  it('uses generic subscription acknowledgements, hashes single-use confirmation tokens, and requires POST confirmation', async () => {
    const email = `subscriber-${runId}@example.test`;
    const initial = await actions.subscribe({ email, consent: true });
    expect(initial).toEqual({ ok: true, message: expect.any(String) });

    const [subscriber] = await requireTestDb().select().from(schema.communitySubscribers).where(eq(schema.communitySubscribers.email, email)).limit(1);
    expect(subscriber).toMatchObject({ status: 'pending' });
    const jobs = await requireTestDb().select().from(schema.mailJobs).where(eq(schema.mailJobs.kind, 'subscription-confirm'));
    const confirmationJob = jobs.at(-1);
    expect(confirmationJob).toBeTruthy();
    const token = tokenFromText(confirmationJob!.textBody);
    const [storedToken] = await requireTestDb()
      .select()
      .from(schema.communityActionTokens)
      .where(eq(schema.communityActionTokens.subscriberId, subscriber!.id))
      .limit(1);
    expect(storedToken?.tokenHash).not.toBe(token);
    expect(storedToken?.usedAt).toBeNull();

    // Opening a URL has not mutated anything; only this explicit Server Action can confirm it.
    expect((await requireTestDb().select().from(schema.communitySubscribers).where(eq(schema.communitySubscribers.id, subscriber!.id)).limit(1))[0]?.status).toBe('pending');
    expect(await actions.confirmSubscription(token)).toMatchObject({ ok: true });
    expect((await requireTestDb().select().from(schema.communitySubscribers).where(eq(schema.communitySubscribers.id, subscriber!.id)).limit(1))[0]?.status).toBe('confirmed');
    expect(await actions.confirmSubscription(token)).toMatchObject({ ok: false, code: 'INVALID_TOKEN' });

    const sameAddress = await actions.subscribe({ email, consent: true });
    const otherAddress = await actions.subscribe({ email: `other-${runId}@example.test`, consent: true });
    expect(sameAddress).toEqual(otherAddress);
  });

  it('does not trust raw forwarded IP headers and atomically caps repeat address attempts', async () => {
    requestHeaders = new Headers({ origin: publicOrigin, 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '198.51.100.25' });
    const email = `limited-${runId}@example.test`;
    await expect(actions.subscribe({ email, consent: true })).resolves.toMatchObject({ ok: true });
    await expect(actions.subscribe({ email, consent: true })).resolves.toMatchObject({ ok: true });
    await expect(actions.subscribe({ email, consent: true })).resolves.toMatchObject({ ok: true });
    expect(await actions.subscribe({ email, consent: true })).toMatchObject({ ok: false, code: 'RATE_LIMITED' });

    const emailBuckets = await requireTestDb()
      .select()
      .from(schema.communityRateLimits)
      .where(eq(schema.communityRateLimits.scope, 'community:subscribe:email'));
    expect(emailBuckets.some((bucket) => bucket.count === 3)).toBe(true);
    const ipBuckets = await requireTestDb()
      .select()
      .from(schema.communityRateLimits)
      .where(eq(schema.communityRateLimits.scope, 'community:subscribe:ip'));
    expect(ipBuckets).toHaveLength(0);
  });

  it('rejects untrusted origins without persisting a public-form request', async () => {
    requestHeaders = new Headers({ origin: 'https://untrusted.example.test', 'sec-fetch-site': 'cross-site' });
    const email = `origin-${runId}@example.test`;
    expect(await actions.subscribe({ email, consent: true })).toMatchObject({ ok: false, code: 'INVALID_ORIGIN' });
    expect(await requireTestDb().select().from(schema.communitySubscribers).where(eq(schema.communitySubscribers.email, email))).toHaveLength(0);
  });

  it('stages applications privately, confirms ownership before sending details, and purges mail on deletion', async () => {
    const email = `applicant-${runId}@example.test`;
    const introduction = '我喜欢 <img src=x onerror=alert(1)> 和科学幻想。';
    expect(
      await actions.submitApplication({
        name: '测试申请人',
        email,
        interests: '动漫、科学',
        introduction,
        consent: true,
      }),
    ).toMatchObject({ ok: true });

    const [application] = await requireTestDb().select().from(schema.communityApplications).where(eq(schema.communityApplications.email, email)).limit(1);
    expect(application?.emailVerifiedAt).toBeNull();
    const overview = await adminActions.getAdminCommunity();
    const staged = overview.applications.find((item) => item.id === application?.id);
    expect(staged).toMatchObject({ emailVerified: false, name: null, email: null, interests: [], introduction: null });

    const verificationJobs = await requireTestDb()
      .select()
      .from(schema.mailJobs)
      .where(eq(schema.mailJobs.dedupeKey, `application-verification:${application!.id}`));
    expect(verificationJobs).toHaveLength(1);
    expect(verificationJobs[0]?.textBody).not.toContain(introduction);
    const token = tokenFromText(verificationJobs[0]!.textBody);
    expect(await actions.confirmApplicationReceipt(token)).toMatchObject({ ok: true });

    const deliveredApplication = (await adminActions.getAdminCommunity()).applications.find((item) => item.id === application!.id);
    expect(deliveredApplication).toMatchObject({ emailVerified: true, name: '测试申请人', email });
    const copy = (await requireTestDb().select().from(schema.mailJobs).where(eq(schema.mailJobs.dedupeKey, `application-copy:${application!.id}`)).limit(1))[0];
    expect(copy?.htmlBody).toContain('&lt;img');

    expect(await adminActions.deleteApplication(application!.id)).toMatchObject({ ok: true });
    expect(await requireTestDb().select().from(schema.communityApplications).where(eq(schema.communityApplications.id, application!.id))).toHaveLength(0);
    const survivingApplicationJobs = await requireTestDb()
      .select({ id: schema.mailJobs.id })
      .from(schema.mailJobs)
      .where(sql`"metadata" ->> 'applicationId' = ${application!.id}`);
    expect(survivingApplicationJobs).toHaveLength(0);
  });

  it('commits initial publication marker and post jobs together, prevents republish mail, and suppresses queued posts on unpublish', async () => {
    const subscriberId = await insertConfirmedSubscriber(`post-reader-${runId}@example.test`);
    const created = await documentsService.saveDocument({
      kind: 'post',
      data: formPost(`community-post-${runId}`, '第一篇社区推送文章'),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    const published = await documentsService.transitionDocument({ id: created.data.id, expectedVersion: created.data.version, action: 'publish' });
    expect(published).toMatchObject({ ok: true });
    if (!published.ok || !published.data) throw new Error('Could not publish test post.');

    const markers = await requireTestDb().select().from(schema.communityPublications).where(eq(schema.communityPublications.documentId, created.data.id));
    expect(markers).toHaveLength(1);
    const postJobs = await requireTestDb().select().from(schema.mailJobs).where(eq(schema.mailJobs.dedupeKey, `post:${created.data.id}:${subscriberId}`));
    expect(postJobs).toHaveLength(1);

    const unpublished = await documentsService.transitionDocument({ id: created.data.id, expectedVersion: published.data.version, action: 'unpublish' });
    expect(unpublished).toMatchObject({ ok: true });
    expect((await requireTestDb().select().from(schema.mailJobs).where(eq(schema.mailJobs.id, postJobs[0]!.id)).limit(1))[0]?.status).toBe('suppressed');
    if (!unpublished.ok || !unpublished.data) throw new Error('Could not unpublish test post.');
    const republished = await documentsService.transitionDocument({ id: created.data.id, expectedVersion: unpublished.data.version, action: 'publish' });
    expect(republished).toMatchObject({ ok: true });
    expect(await requireTestDb().select().from(schema.mailJobs).where(eq(schema.mailJobs.dedupeKey, `post:${created.data.id}:${subscriberId}`))).toHaveLength(1);
  });

  it('rolls back an initial-publication marker and queued mail together when its transaction aborts', async () => {
    const subscriberId = await insertConfirmedSubscriber(`rollback-reader-${runId}@example.test`);
    const documentId = randomUUID();
    const snapshot = formPost(`rollback-${runId}`, '回滚文章');
    await requireTestDb().insert(schema.documents).values({
      id: documentId,
      kind: 'post',
      status: 'draft',
      authorId: admin.id,
      draft: snapshot,
    });
    // A throw after the publication helper proves marker, token and outbox insertions share the
    // enclosing transaction; the document itself is persisted first solely to satisfy the
    // publication marker's foreign key while exercising the helper's transaction boundary.
    await expect(
      (async () => {
        const database = await import('@/lib/db');
        await database.db.transaction(async (tx) => {
          await publication.recordInitialPublishedPost(tx, {
            documentId,
            snapshot,
            publishedAt: new Date(),
            delivery: { publicUrl: publicOrigin },
          });
          throw new Error('intentional rollback');
        });
      })(),
    ).rejects.toThrow('intentional rollback');
    expect(await requireTestDb().select().from(schema.communityPublications).where(eq(schema.communityPublications.documentId, documentId))).toHaveLength(0);
    expect(await requireTestDb().select().from(schema.mailJobs).where(eq(schema.mailJobs.dedupeKey, `post:${documentId}:${subscriberId}`))).toHaveLength(0);
  });

  it('serializes manual-push requests and shares auto/manual per-subscriber dedupe', async () => {
    await setMailConfiguration({ notifyOnPublish: false, allowManualPush: true });
    const subscriberId = await insertConfirmedSubscriber(`manual-reader-${runId}@example.test`);
    const created = await documentsService.saveDocument({
      kind: 'post',
      data: formPost(`manual-${runId}`, '手动推送文章'),
    });
    if (!created.ok) throw new Error(created.error);
    const published = await documentsService.transitionDocument({ id: created.data.id, expectedVersion: created.data.version, action: 'publish' });
    if (!published.ok || !published.data) throw new Error('Could not publish manual post.');
    await expect(publication.prepareManualPostDelivery()).resolves.toEqual({ publicUrl: publicOrigin });
    const preview = await adminActions.previewManualPush(created.data.id);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview).toMatchObject({ ok: true, data: { recipientCount: 1 } });

    const [first, second] = await Promise.all([
      adminActions.sendManualPush({ documentId: created.data.id, expectedSnapshotHash: preview.data.snapshotHash }),
      adminActions.sendManualPush({ documentId: created.data.id, expectedSnapshotHash: preview.data.snapshotHash }),
    ]);
    expect([first, second].filter((result) => result.ok && result.data.queued === 1)).toHaveLength(1);
    expect(await requireTestDb().select().from(schema.mailJobs).where(eq(schema.mailJobs.dedupeKey, `post:${created.data.id}:${subscriberId}`))).toHaveLength(1);
  });
});
