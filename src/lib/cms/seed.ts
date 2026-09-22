import 'server-only';

import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';

import type { ActionResult, DocumentData } from './types';
import { defaultSiteSettings, SITE_SETTINGS_KEY } from './defaults';
import { assertDatabase, safeActionError } from './internal';
import { isPlainObject, validateDocumentData, validateMemberInput } from './validation';
import { demoCategories, demoMembers, demoPages, demoPosts, demoTags } from '@/lib/content/demo';
import { db } from '@/lib/db';
import {
  auditLog,
  categories,
  documentCategories,
  documents,
  documentTags,
  members,
  media,
  revisions,
  settings,
  tags,
  users,
} from '@/lib/db/schema';

type SeedResult = { documents: number; taxonomy: number; members: number };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const DEMO_COVER_FILENAME = '__darwin_demo_imagination__.png';

function isBlankOrLegacyDefaultNavigation(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const navigation = value.navigation;
  if (!Array.isArray(navigation) || navigation.length === 0) return true;
  // Upgrade only the previous built-in three-link default. Administrator-made
  // navigation, including custom links, remains untouched.
  return (
    navigation.length === 3 &&
    navigation[0]?.id === 'home' &&
    navigation[0]?.label === '首页' &&
    navigation[0]?.href === '/' &&
    navigation[0]?.visible === true &&
    navigation[0]?.order === 0 &&
    navigation[0]?.fixed === true &&
    navigation[1]?.id === 'journal' &&
    navigation[1]?.label === '社团刊物' &&
    navigation[1]?.href === '/search' &&
    navigation[1]?.visible === true &&
    navigation[1]?.order === 1 &&
    navigation[2]?.id === 'members' &&
    navigation[2]?.label === '主要成员' &&
    navigation[2]?.href === '/members' &&
    navigation[2]?.visible === true &&
    navigation[2]?.order === 2 &&
    navigation[2]?.fixed === true
  );
}

function failure(error: string, code?: string): ActionResult<SeedResult> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

async function upsertCategory(tx: Transaction, source: (typeof demoCategories)[number]) {
  const [row] = await tx
    .insert(categories)
    .values({ name: source.name, slug: source.slug, description: source.description ?? '' })
    .onConflictDoUpdate({
      target: categories.slug,
      set: { name: source.name, description: source.description ?? '', updatedAt: new Date() },
    })
    .returning({ id: categories.id });
  if (!row) throw new Error('Could not seed a category.');
  return row.id;
}

async function upsertTag(tx: Transaction, source: (typeof demoTags)[number]) {
  const [row] = await tx
    .insert(tags)
    .values({ name: source.name, slug: source.slug, description: source.description ?? '' })
    .onConflictDoUpdate({
      target: tags.slug,
      set: { name: source.name, description: source.description ?? '', updatedAt: new Date() },
    })
    .returning({ id: tags.id });
  if (!row) throw new Error('Could not seed a tag.');
  return row.id;
}

function mediaDirectory(): string {
  return resolve(process.env.MEDIA_DIR?.trim() || process.env.MEDIA_ROOT?.trim() || resolve(process.cwd(), 'data', 'uploads'));
}

function mediaPath(storageKey: string): string {
  if (!/^[0-9a-f-]{36}\.png$/i.test(storageKey)) throw new Error('Invalid demo media key.');
  const root = mediaDirectory();
  const path = resolve(root, storageKey);
  if (!path.startsWith(`${root}${sep}`)) throw new Error('Invalid demo media path.');
  return path;
}

async function demoCoverBytes(): Promise<{ data: Buffer; width: number; height: number }> {
  const source = await readFile(resolve(process.cwd(), 'public', 'images', 'imagination.png'));
  const encoded = await sharp(source, { limitInputPixels: 36_000_000, failOn: 'error' }).rotate().png().toBuffer({ resolveWithObject: true });
  if (encoded.info.width * encoded.info.height > 36_000_000) throw new Error('Demo image is too large.');
  return { data: encoded.data, width: encoded.info.width, height: encoded.info.height };
}

async function writeDemoCover(storageKey: string, data: Buffer): Promise<void> {
  const directory = mediaDirectory();
  await mkdir(directory, { recursive: true });
  await writeFile(mediaPath(storageKey), data, { flag: 'w' });
}

/** Registers the bundled development illustration in the same controlled media store as user uploads. */
async function ensureDemoCover(adminId: string): Promise<string> {
  const [existing] = await db
    .select({ id: media.id, storageKey: media.storageKey })
    .from(media)
    .where(and(eq(media.ownerId, adminId), eq(media.filename, DEMO_COVER_FILENAME)))
    .limit(1);
  if (existing) {
    try {
      await access(mediaPath(existing.storageKey));
      return `/api/media/${existing.id}`;
    } catch {
      const image = await demoCoverBytes();
      await writeDemoCover(existing.storageKey, image.data);
      return `/api/media/${existing.id}`;
    }
  }

  const image = await demoCoverBytes();
  const storageKey = `${randomUUID()}.png`;
  const path = mediaPath(storageKey);
  await writeDemoCover(storageKey, image.data);
  try {
    const [created] = await db
      .insert(media)
      .values({
        ownerId: adminId,
        filename: DEMO_COVER_FILENAME,
        storageKey,
        mimeType: 'image/png',
        width: image.width,
        height: image.height,
        size: image.data.length,
        alt: '原创幻想景观插画：建筑、轨道与遥远的星球',
      })
      .returning({ id: media.id });
    if (!created) throw new Error('Could not register the demo cover.');
    return `/api/media/${created.id}`;
  } catch (error) {
    try {
      await unlink(path);
    } catch {
      // The next explicit demo seed can repair an orphaned image if needed.
    }
    throw error;
  }
}

function postData(
  post: (typeof demoPosts)[number],
  categoryIds: Map<string, string>,
  tagIds: Map<string, string>,
  demoCoverUrl: string,
): DocumentData {
  const value: DocumentData = {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    coverUrl: post.coverUrl === '/images/imagination.png' ? demoCoverUrl : post.coverUrl,
    coverAlt: post.coverAlt,
    categoryId: post.category ? categoryIds.get(post.category.id) ?? null : null,
    tagIds: post.tags.flatMap((tag) => {
      const id = tagIds.get(tag.id);
      return id ? [id] : [];
    }),
    body: post.body,
    blocks: [],
    description: '',
    featured: post.featured,
    demo: true,
  };
  return validateDocumentData('post', value, { allowDemo: true, allowSeedFixtures: true });
}

function pageData(page: (typeof demoPages)[number]): DocumentData {
  const fallbackBody = page.blocks.find((block) => block.type === 'richtext')?.body ?? { type: 'doc', content: [] };
  return validateDocumentData(
    'page',
    {
      slug: page.slug,
      title: page.title,
      excerpt: '',
      coverUrl: null,
      coverAlt: '',
      categoryId: null,
      tagIds: [],
      body: fallbackBody,
      blocks: page.blocks,
      description: page.description,
      featured: false,
      demo: true,
    },
    { allowDemo: true, allowSeedFixtures: true },
  );
}

async function seedDocument(
  tx: Transaction,
  actorId: string,
  kind: 'post' | 'page',
  data: DocumentData,
  publishedAt: Date,
): Promise<boolean> {
  const [existing] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.kind, kind), eq(documents.publishedSlug, data.slug)))
    .limit(1);
  if (existing) return false;
  const [document] = await tx
    .insert(documents)
    .values({
      kind,
      status: 'published',
      authorId: actorId,
      draft: data,
      published: data,
      publishedSlug: data.slug,
      publishedAt,
      version: 1,
    })
    .returning();
  if (!document) throw new Error('Could not seed a document.');
  if (data.categoryId) await tx.insert(documentCategories).values({ documentId: document.id, categoryId: data.categoryId });
  if (data.tagIds.length > 0) await tx.insert(documentTags).values(data.tagIds.map((tagId) => ({ documentId: document.id, tagId })));
  await tx.insert(revisions).values({ documentId: document.id, version: 1, data, actorId, note: '开发演示内容' });
  return true;
}

/** Explicit development/bootstrap seeding only; this function is never invoked at app startup. */
export async function seedDemo(adminId: string): Promise<ActionResult<SeedResult>> {
  assertDatabase();
  try {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(adminId)) return failure('管理员 ID 不正确。', 'VALIDATION');
    const [admin] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, adminId)).limit(1);
    if (!admin || admin.role !== 'admin') return failure('演示内容只能由真实管理员初始化。', 'FORBIDDEN');
    const demoCoverUrl = await ensureDemoCover(admin.id);

    const result = await db.transaction(async (tx) => {
      const categoryIds = new Map<string, string>();
      const tagIds = new Map<string, string>();
      for (const category of demoCategories) categoryIds.set(category.id, await upsertCategory(tx, category));
      for (const tag of demoTags) tagIds.set(tag.id, await upsertTag(tx, tag));

      let documentCount = 0;
      for (const post of demoPosts) {
        if (await seedDocument(tx, admin.id, 'post', postData(post, categoryIds, tagIds, demoCoverUrl), new Date(post.publishedAt))) documentCount += 1;
      }
      for (const page of demoPages) {
        if (await seedDocument(tx, admin.id, 'page', pageData(page), new Date(page.publishedAt))) documentCount += 1;
      }

      let memberCount = 0;
      for (const member of demoMembers) {
        const [existing] = await tx.select({ id: members.id }).from(members).where(eq(members.name, member.name)).limit(1);
        if (existing) continue;
        const value = validateMemberInput({ ...member, id: undefined });
        await tx.insert(members).values({
          name: value.name,
          role: value.role,
          bio: value.bio,
          avatarUrl: value.avatarUrl,
          interests: value.interests,
          links: value.links,
          order: value.order,
        });
        memberCount += 1;
      }

      const [savedSettings] = await tx
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(eq(settings.key, SITE_SETTINGS_KEY))
        .limit(1);
      if (!savedSettings) {
        await tx.insert(settings).values({ key: SITE_SETTINGS_KEY, value: defaultSiteSettings });
      } else if (isBlankOrLegacyDefaultNavigation(savedSettings.value)) {
        await tx.update(settings).set({ value: defaultSiteSettings, updatedAt: new Date() }).where(eq(settings.key, SITE_SETTINGS_KEY));
      }
      await tx.insert(auditLog).values({
        actorId: admin.id,
        action: 'seed.demo',
        resourceId: null,
        detail: { documents: documentCount, members: memberCount },
      });
      return { documents: documentCount, taxonomy: demoCategories.length + demoTags.length, members: memberCount };
    });
    return { ok: true, data: result };
  } catch (error) {
    const result = safeActionError(error, '初始化演示内容失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}

/** Bootstrap adapter; callers opt in with `scripts/bootstrap.ts --demo`. */
export async function seedDemoContent({ adminId }: { adminId: string }): Promise<void> {
  const result = await seedDemo(adminId);
  if (!result.ok) throw new Error(result.error);
}
