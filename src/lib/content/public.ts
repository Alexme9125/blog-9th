import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql, type SQL } from 'drizzle-orm';

import { defaultSiteSettings, SITE_SETTINGS_KEY } from '@/lib/cms/defaults';
import { assertDatabase } from '@/lib/cms/internal';
import { validateDocumentData, validateMemberInput, validateSettingsInput } from '@/lib/cms/validation';
import type { DocumentData } from '@/lib/cms/types';
import { db } from '@/lib/db';
import { categories, documents, members, settings, tags, users } from '@/lib/db/schema';
import type { Member, PostQuery, PostResult, PublicPage, PublicPost, SiteSettings, Taxonomy } from './types';

type PublishedDocumentRow = {
  id: string;
  authorId: string;
  authorName: string;
  published: DocumentData | null;
  publishedAt: Date | null;
};

const publishedPostSelection = {
  id: documents.id,
  authorId: documents.authorId,
  authorName: users.name,
  published: documents.published,
  publishedAt: documents.publishedAt,
};

function toTaxonomy(row: typeof categories.$inferSelect): Taxonomy {
  return { id: row.id, name: row.name, slug: row.slug, ...(row.description ? { description: row.description } : {}) };
}

function hasValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function escapeLikeKeyword(value: string): string {
  // Use ! as the explicit escape character so % and _ remain literal search input.
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

function readingMinutes(body: DocumentData['body']): number {
  const read = (node: DocumentData['body']): number => (node.text?.length ?? 0) + (node.content?.reduce((sum, child) => sum + read(child), 0) ?? 0);
  return Math.max(1, Math.ceil(read(body) / 400));
}

function readPublishedData(kind: 'post' | 'page', value: DocumentData | null): DocumentData | null {
  if (!value) return null;
  try {
    return validateDocumentData(kind, value, {
      allowDemo: true,
      allowSeedFixtures: process.env.NODE_ENV !== 'production',
    });
  } catch {
    return null;
  }
}

async function resolveTaxonomy(data: DocumentData[]): Promise<{ categories: Map<string, Taxonomy>; tags: Map<string, Taxonomy> }> {
  const categoryIds = [...new Set(data.flatMap((item) => (item.categoryId ? [item.categoryId] : [])))];
  const tagIds = [...new Set(data.flatMap((item) => item.tagIds))];
  const [categoryRows, tagRows] = await Promise.all([
    categoryIds.length ? db.select().from(categories).where(inArray(categories.id, categoryIds)) : Promise.resolve([]),
    tagIds.length ? db.select().from(tags).where(inArray(tags.id, tagIds)) : Promise.resolve([]),
  ]);
  return {
    categories: new Map(categoryRows.map((row) => [row.id, toTaxonomy(row)])),
    tags: new Map(tagRows.map((row) => [row.id, toTaxonomy(row)])),
  };
}

function toPublicPost(
  row: PublishedDocumentRow,
  data: DocumentData,
  taxonomy: { categories: Map<string, Taxonomy>; tags: Map<string, Taxonomy> },
): PublicPost | null {
  if (!row.publishedAt) return null;
  const category = data.categoryId ? taxonomy.categories.get(data.categoryId) ?? null : null;
  return {
    id: row.id,
    slug: data.slug,
    title: data.title,
    excerpt: data.excerpt,
    coverUrl: data.coverUrl,
    coverAlt: data.coverAlt,
    author: { id: row.authorId, name: data.demo ? 'Darwin 编辑部' : row.authorName },
    category,
    tags: data.tagIds.flatMap((id) => {
      const tag = taxonomy.tags.get(id);
      return tag ? [tag] : [];
    }),
    body: data.body,
    publishedAt: row.publishedAt.toISOString(),
    readingMinutes: readingMinutes(data.body),
    featured: data.featured,
    ...(data.demo ? { demo: true } : {}),
  };
}

function publicSnapshotConditions(kind: 'post' | 'page'): SQL[] {
  return [
    eq(documents.kind, kind),
    isNotNull(documents.published),
    isNotNull(documents.publishedSlug),
    isNotNull(documents.publishedAt),
    isNull(documents.deletedAt),
    ne(documents.status, 'archived'),
  ];
}

const publicSearchText = sql<string>`concat_ws(
  ' ',
  ${documents.published}->>'title',
  ${documents.published}->>'excerpt',
  coalesce(jsonb_path_query_array(${documents.published}, '$.body.**.text')::text, '')
)`;

async function selectPublicPosts(conditions: SQL[], limit?: number, offset = 0): Promise<PublicPost[]> {
  assertDatabase();
  const selection = db
    .select(publishedPostSelection)
    .from(documents)
    .innerJoin(users, eq(documents.authorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(documents.publishedAt));
  const rows = limit === undefined ? await selection : await selection.limit(limit).offset(offset);
  const pairs = rows.flatMap((row) => {
    const data = readPublishedData('post', row.published);
    return data ? [{ row, data }] : [];
  });
  const taxonomy = await resolveTaxonomy(pairs.map((pair) => pair.data));
  return pairs.flatMap((pair) => {
    const post = toPublicPost(pair.row, pair.data, taxonomy);
    return post ? [post] : [];
  });
}

export async function getPublicPosts(query: PostQuery = {}): Promise<PostResult> {
  const page = Number.isInteger(query.page) ? Math.max(1, Math.min(query.page ?? 1, 10_000)) : 1;
  const limit = Number.isInteger(query.limit) ? Math.max(1, Math.min(query.limit ?? 8, 100)) : 8;
  const categorySlug = typeof query.category === 'string' ? query.category.slice(0, 100) : '';
  const tagSlug = typeof query.tag === 'string' ? query.tag.slice(0, 100) : '';
  const text = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  const conditions = publicSnapshotConditions('post');
  if (categorySlug) {
    const [category] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, categorySlug)).limit(1);
    if (!category) return { posts: [], total: 0, page, pages: 1 };
    conditions.push(sql`${documents.published}->>'categoryId' = ${category.id}`);
  }
  if (tagSlug) {
    const [tag] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, tagSlug)).limit(1);
    if (!tag) return { posts: [], total: 0, page, pages: 1 };
    conditions.push(sql`${documents.published}->'tagIds' @> ${JSON.stringify([tag.id])}::jsonb`);
  }
  if (text) conditions.push(sql`${publicSearchText} ILIKE ${`%${escapeLikeKeyword(text)}%`} ESCAPE '!'`);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(documents).where(and(...conditions));
  const total = count?.total ?? 0;
  const posts = await selectPublicPosts(conditions, limit, (page - 1) * limit);
  return {
    posts,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getPublicPost(slug: string): Promise<PublicPost | null> {
  assertDatabase();
  if (!hasValidSlug(slug)) return null;
  const conditions = publicSnapshotConditions('post');
  conditions.push(eq(documents.publishedSlug, slug));
  const [row] = await db
    .select(publishedPostSelection)
    .from(documents)
    .innerJoin(users, eq(documents.authorId, users.id))
    .where(and(...conditions))
    .limit(1);
  if (!row) return null;
  const data = readPublishedData('post', row.published);
  if (!data) return null;
  const taxonomy = await resolveTaxonomy([data]);
  return toPublicPost(row, data, taxonomy);
}

export async function getCategories(): Promise<Taxonomy[]> {
  const posts = await selectPublicPosts(publicSnapshotConditions('post'));
  const categoriesById = new Map(posts.flatMap((post) => (post.category ? [[post.category.id, post.category] as const] : [])));
  return [...categoriesById.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export async function getTags(): Promise<Taxonomy[]> {
  const posts = await selectPublicPosts(publicSnapshotConditions('post'));
  const tagsById = new Map(posts.flatMap((post) => post.tags.map((tag) => [tag.id, tag] as const)));
  return [...tagsById.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export async function getSiteSettings(): Promise<SiteSettings> {
  assertDatabase();
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SITE_SETTINGS_KEY)).limit(1);
  if (!row) return defaultSiteSettings;
  try {
    return validateSettingsInput(row.value);
  } catch {
    return defaultSiteSettings;
  }
}

export async function getMembers(): Promise<Member[]> {
  assertDatabase();
  const rows = await db
    .select({
      id: members.id,
      name: members.name,
      role: members.role,
      bio: members.bio,
      avatarUrl: members.avatarUrl,
      interests: members.interests,
      links: members.links,
      order: members.order,
    })
    .from(members)
    .orderBy(asc(members.order), asc(members.name));
  return rows.flatMap((row) => {
    try {
      const value = validateMemberInput(row);
      if (!value.id) return [];
      return [{
        id: value.id,
        name: value.name,
        role: value.role,
        bio: value.bio,
        avatarUrl: value.avatarUrl,
        interests: value.interests,
        links: value.links,
        order: value.order,
      }];
    } catch {
      return [];
    }
  });
}

export async function getPublicPage(slug: string): Promise<PublicPage | null> {
  assertDatabase();
  if (!hasValidSlug(slug)) return null;
  const conditions = publicSnapshotConditions('page');
  conditions.push(eq(documents.publishedSlug, slug));
  const [row] = await db
    .select({ id: documents.id, published: documents.published, publishedAt: documents.publishedAt })
    .from(documents)
    .where(and(...conditions))
    .limit(1);
  if (!row || !row.publishedAt) return null;
  const data = readPublishedData('page', row.published);
  if (!data) return null;
  return {
    id: row.id,
    slug: data.slug,
    title: data.title,
    description: data.description,
    blocks: data.blocks,
    publishedAt: row.publishedAt.toISOString(),
  };
}

/** Published static pages for sitemap generation and other server-only feeds. */
export async function getPublicPages(): Promise<PublicPage[]> {
  assertDatabase();
  const rows = await db
    .select({ id: documents.id, published: documents.published, publishedAt: documents.publishedAt })
    .from(documents)
    .where(and(...publicSnapshotConditions('page')))
    .orderBy(desc(documents.publishedAt));
  return rows.flatMap((row) => {
    if (!row.publishedAt) return [];
    const data = readPublishedData('page', row.published);
    if (!data) return [];
    return [{
      id: row.id,
      slug: data.slug,
      title: data.title,
      description: data.description,
      blocks: data.blocks,
      publishedAt: row.publishedAt.toISOString(),
    }];
  });
}
