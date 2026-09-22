import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AdminUser, DocumentData } from '@/lib/cms/types';

const state = vi.hoisted(() => {
  const mediaDirectory = `${process.cwd()}/.data/cms-test-media-${Date.now()}`;
  process.env.MEDIA_DIR = mediaDirectory;
  return { user: null as AdminUser | null, mediaDirectory };
});

vi.mock('@/lib/auth/server', () => ({
  getSessionUser: async () => state.user,
  requireUser: async () => {
    if (!state.user) throw new Error('Unauthenticated test request');
    return state.user;
  },
  requireRole: async (roles: AdminUser['role'][]) => {
    if (!state.user || !roles.includes(state.user.role)) throw new Error('Forbidden test request');
    return state.user;
  },
  requireMutationUser: async (roles?: AdminUser['role'][]) => {
    if (!state.user || (roles && !roles.includes(state.user.role))) throw new Error('Forbidden test mutation');
    return state.user;
  },
}));

import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';

import {
  getAdminDocuments,
  getAdminDocument,
  getRevisions,
  restoreRevision,
  saveDocument,
  transitionDocument,
} from '@/lib/cms/documents';
import { deleteMedia, getMediaItemByUrl, readMediaForRequest, uploadMedia } from '@/lib/cms/media';
import { saveMember } from '@/lib/cms/members';
import { saveTaxonomy } from '@/lib/cms/taxonomy';
import { validateRichNode } from '@/lib/cms/validation';
import { getMembers, getPublicPost, getPublicPosts } from '@/lib/content/public';
import { db } from '@/lib/db';
import { categories, documents, media, members, tags, users } from '@/lib/db/schema';

const runId = randomUUID();
const admin: AdminUser = {
  id: `cms-admin-${runId}`,
  name: 'CMS Test Admin',
  email: `cms-admin-${runId}@example.test`,
  role: 'admin',
  disabled: false,
  mustChangePassword: false,
};
const author: AdminUser = {
  id: `cms-author-${runId}`,
  name: 'CMS Test Author',
  email: `cms-author-${runId}@example.test`,
  role: 'author',
  disabled: false,
  mustChangePassword: false,
};

function data(input: {
  slug: string;
  title: string;
  categoryId: string | null;
  tagIds: string[];
  coverUrl?: string | null;
}): DocumentData {
  return {
    slug: input.slug,
    title: input.title,
    excerpt: `${input.title} 摘要`,
    coverUrl: input.coverUrl ?? null,
    coverAlt: input.coverUrl ? '测试封面' : '',
    categoryId: input.categoryId,
    tagIds: input.tagIds,
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `${input.title} 正文` }] }] },
    blocks: [],
    description: '',
    featured: false,
  };
}

describe('CMS database integration', () => {
  let categoryId = '';
  let replacementCategoryId = '';
  let tagId = '';
  let replacementTagId = '';
  let mediaId = '';
  let revisionOnlyMediaId = '';
  let memberId = '';
  let postId = '';

  beforeAll(async () => {
    await db.insert(users).values([
      { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      { id: author.id, name: author.name, email: author.email, role: author.role },
    ]);
    state.user = admin;

    const category = await saveTaxonomy({ kind: 'category', name: `测试分类 ${runId}`, slug: `cms-category-${runId}` });
    const replacementCategory = await saveTaxonomy({ kind: 'category', name: `替代分类 ${runId}`, slug: `cms-category-next-${runId}` });
    const tag = await saveTaxonomy({ kind: 'tag', name: `测试标签 ${runId}`, slug: `cms-tag-${runId}` });
    const replacementTag = await saveTaxonomy({ kind: 'tag', name: `替代标签 ${runId}`, slug: `cms-tag-next-${runId}` });
    if (!category.ok || !replacementCategory.ok || !tag.ok || !replacementTag.ok) throw new Error('Could not create test taxonomy.');
    categoryId = category.data.id;
    replacementCategoryId = replacementCategory.data.id;
    tagId = tag.data.id;
    replacementTagId = replacementTag.data.id;

    const member = await saveMember({
      name: `CMS Public Member ${runId}`,
      role: 'Integration tester',
      bio: 'Verifies that the public adapter excludes database timestamp columns before validation.',
      avatarUrl: null,
      interests: ['testing'],
      links: [],
      order: 9_999,
    });
    if (!member.ok) throw new Error(member.error);
    memberId = member.data.id;

    const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#345678' } }).png().toBuffer();
    const formData = new FormData();
    formData.set('file', new File([new Uint8Array(png)], 'cms-test.png', { type: 'image/png' }));
    formData.set('alt', 'CMS 测试图片');
    const uploaded = await uploadMedia(formData);
    if (!uploaded.ok) throw new Error(uploaded.error);
    mediaId = uploaded.data.id;
  });

  afterAll(async () => {
    state.user = admin;
    await db.delete(documents).where(inArray(documents.authorId, [admin.id, author.id]));
    if (mediaId) await db.delete(media).where(eq(media.id, mediaId));
    if (revisionOnlyMediaId) await db.delete(media).where(eq(media.id, revisionOnlyMediaId));
    if (memberId) await db.delete(members).where(eq(members.id, memberId));
    if (categoryId || replacementCategoryId) await db.delete(categories).where(inArray(categories.id, [categoryId, replacementCategoryId].filter(Boolean)));
    if (tagId || replacementTagId) await db.delete(tags).where(inArray(tags.id, [tagId, replacementTagId].filter(Boolean)));
    await db.delete(users).where(inArray(users.id, [admin.id, author.id]));
    await rm(state.mediaDirectory, { recursive: true, force: true });
  });

  it('normalizes Tiptap default attributes without accepting unsupported fields', () => {
    const normalized = validateRichNode({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '带链接的文字',
              marks: [{ type: 'link', attrs: { href: 'https://example.test', target: '_blank', rel: 'noopener noreferrer', class: null, title: null } }],
            },
          ],
        },
        { type: 'image', attrs: { src: '/api/media/00000000-0000-4000-8000-000000000000', alt: null, title: null, width: null, height: null } },
        { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'const answer = 42;' }] },
        {
          type: 'orderedList',
          attrs: { start: 1, type: null },
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一项' }] }] }],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '表头' }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(normalized.content?.[0]?.content?.[0]?.marks?.[0]).toEqual({ type: 'link', attrs: { href: 'https://example.test' } });
    expect(normalized.content?.[1]).toEqual({ type: 'image', attrs: { src: '/api/media/00000000-0000-4000-8000-000000000000' } });
    expect(normalized.content?.[2]).toEqual({ type: 'codeBlock', content: [{ type: 'text', text: 'const answer = 42;' }] });
    expect(normalized.content?.[3]?.attrs).toBeUndefined();
    expect(normalized.content?.[4]?.content?.[0]?.content?.[0]?.attrs).toBeUndefined();
    expect(() => validateRichNode({ type: 'doc', content: [{ type: 'rawHTML', html: '<script>alert(1)</script>' }] })).toThrow();
  });

  it('adapts member database rows before public validation', async () => {
    expect(await getMembers()).toContainEqual(
      expect.objectContaining({ id: memberId, name: `CMS Public Member ${runId}`, interests: ['testing'] }),
    );
  });

  it('protects media used only by a historical revision', async () => {
    state.user = admin;
    const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#654321' } }).png().toBuffer();
    const formData = new FormData();
    formData.set('file', new File([new Uint8Array(png)], 'revision-only.png', { type: 'image/png' }));
    formData.set('alt', '历史修订图片');
    const uploaded = await uploadMedia(formData);
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) throw new Error(uploaded.error);
    revisionOnlyMediaId = uploaded.data.id;

    const slug = `cms-revision-only-media-${runId}`;
    const created = await saveDocument({
      kind: 'post',
      data: data({
        slug,
        title: '历史修订媒体',
        categoryId,
        tagIds: [tagId],
        coverUrl: `/api/media/${revisionOnlyMediaId}`,
      }),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const removedFromCurrentDraft = await saveDocument({
      id: created.data.id,
      kind: 'post',
      expectedVersion: created.data.version,
      data: data({ slug, title: '历史修订媒体已移除', categoryId, tagIds: [tagId] }),
    });
    expect(removedFromCurrentDraft.ok).toBe(true);
    expect(await deleteMedia(revisionOnlyMediaId)).toMatchObject({ ok: false, code: 'REFERENCED' });
  });

  it('keeps a published snapshot isolated from later draft changes and protects referenced media', async () => {
    state.user = null;
    const privateRead = await readMediaForRequest(mediaId);
    expect(privateRead).toEqual({ ok: false, status: 401 });
    expect(await getMediaItemByUrl(`/api/media/${mediaId}`)).toBeNull();

    state.user = author;
    const created = await saveDocument({
      kind: 'post',
      data: data({
        slug: `cms-snapshot-${runId}`,
        title: '发布版本标题',
        categoryId,
        tagIds: [tagId],
        coverUrl: `/api/media/${mediaId}`,
      }),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    postId = created.data.id;
    expect(created.data.version).toBe(1);

    const submitted = await transitionDocument({ id: postId, expectedVersion: 1, action: 'submit' });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok || !submitted.data) throw new Error('Could not submit test document.');
    expect(submitted.data.version).toBe(2);

    const authorPublish = await transitionDocument({ id: postId, expectedVersion: 2, action: 'publish' });
    expect(authorPublish).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    state.user = admin;
    const published = await transitionDocument({ id: postId, expectedVersion: 2, action: 'publish' });
    expect(published.ok).toBe(true);
    if (!published.ok || !published.data) throw new Error('Could not publish test document.');
    expect(published.data.version).toBe(3);

    const publicBeforeDraftEdit = await getPublicPost(`cms-snapshot-${runId}`);
    expect(publicBeforeDraftEdit).toMatchObject({ title: '发布版本标题', coverUrl: `/api/media/${mediaId}` });
    expect(publicBeforeDraftEdit?.category?.id).toBe(categoryId);
    expect(publicBeforeDraftEdit?.tags.map((entry) => entry.id)).toEqual([tagId]);

    state.user = author;
    expect(await getAdminDocument(postId)).not.toBeNull();

    state.user = null;
    const publicRead = await readMediaForRequest(mediaId);
    expect(publicRead.ok).toBe(true);
    if (publicRead.ok) expect(publicRead.public).toBe(true);

    state.user = admin;
    const changedDraft = await saveDocument({
      id: postId,
      kind: 'post',
      expectedVersion: 3,
      data: data({
        slug: `cms-draft-only-${runId}`,
        title: '只存在于草稿的标题',
        categoryId: replacementCategoryId,
        tagIds: [replacementTagId],
      }),
    });
    expect(changedDraft.ok).toBe(true);
    if (!changedDraft.ok) throw new Error(changedDraft.error);
    expect(changedDraft.data.version).toBe(4);

    const publicAfterDraftEdit = await getPublicPost(`cms-snapshot-${runId}`);
    expect(publicAfterDraftEdit).toMatchObject({ title: '发布版本标题', coverUrl: `/api/media/${mediaId}` });
    expect(publicAfterDraftEdit?.category?.id).toBe(categoryId);
    expect(publicAfterDraftEdit?.tags.map((entry) => entry.id)).toEqual([tagId]);
    expect(await getPublicPost(`cms-draft-only-${runId}`)).toBeNull();
    expect((await getPublicPosts({ q: '只存在于草稿' })).total).toBe(0);
    expect((await getPublicPosts({ q: '发布版本标题' })).total).toBe(1);
    expect((await getPublicPosts({ q: 'doc' })).total).toBe(0);
    expect((await getPublicPosts({ q: '发布%标题' })).total).toBe(0);
    expect((await getPublicPosts({ q: '发布__标题' })).total).toBe(0);

    state.user = author;
    const submittedRevision = await transitionDocument({ id: postId, expectedVersion: 4, action: 'submit' });
    expect(submittedRevision.ok).toBe(true);
    if (!submittedRevision.ok || !submittedRevision.data) throw new Error('Could not submit a published revision.');
    expect(submittedRevision.data.status).toBe('review');
    expect(await getPublicPost(`cms-snapshot-${runId}`)).toMatchObject({ title: '发布版本标题' });
    const publicReadDuringReview = await readMediaForRequest(mediaId);
    expect(publicReadDuringReview).toMatchObject({ ok: true, public: true });

    state.user = admin;
    const returnedRevision = await transitionDocument({ id: postId, expectedVersion: 5, action: 'return' });
    expect(returnedRevision.ok).toBe(true);
    if (!returnedRevision.ok || !returnedRevision.data) throw new Error('Could not return a published revision.');
    expect(returnedRevision.data.status).toBe('draft');
    expect(await getPublicPost(`cms-snapshot-${runId}`)).toMatchObject({ title: '发布版本标题' });

    const staleSave = await saveDocument({
      id: postId,
      kind: 'post',
      expectedVersion: 4,
      data: data({ slug: `cms-stale-${runId}`, title: '陈旧编辑', categoryId, tagIds: [tagId] }),
    });
    expect(staleSave).toMatchObject({ ok: false, code: 'CONFLICT' });

    const revisions = await getRevisions(postId);
    expect(revisions.map((revision) => revision.version)).toEqual([6, 5, 4, 3, 2, 1]);
    const initialRevision = revisions.find((revision) => revision.version === 1);
    expect(initialRevision).toBeDefined();
    const restoredRevision = await restoreRevision(postId, initialRevision!.id, 6);
    expect(restoredRevision.ok).toBe(true);
    if (!restoredRevision.ok) throw new Error(restoredRevision.error);
    expect(restoredRevision.data.version).toBe(7);

    const cannotDeleteReferencedMedia = await deleteMedia(mediaId);
    expect(cannotDeleteReferencedMedia).toMatchObject({ ok: false, code: 'REFERENCED' });

    state.user = author;
    expect(await transitionDocument({ id: postId, expectedVersion: 7, action: 'trash' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    state.user = admin;
    const republished = await transitionDocument({ id: postId, expectedVersion: 7, action: 'publish' });
    expect(republished.ok).toBe(true);
    if (!republished.ok || !republished.data) throw new Error('Could not republish an already-published document.');
    const trashed = await transitionDocument({ id: postId, expectedVersion: republished.data.version, action: 'trash' });
    expect(trashed.ok).toBe(true);
    expect(await getPublicPost(`cms-snapshot-${runId}`)).toBeNull();
    if (!trashed.ok || !trashed.data) throw new Error('Could not trash test document.');
    expect((await getAdminDocuments({ status: 'trash' })).map((document) => document.id)).toContain(postId);

    state.user = author;
    expect(await transitionDocument({ id: postId, expectedVersion: trashed.data.version, action: 'restore' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    state.user = admin;
    const restored = await transitionDocument({ id: postId, expectedVersion: trashed.data.version, action: 'restore' });
    expect(restored.ok).toBe(true);
    if (!restored.ok || !restored.data) throw new Error('Could not restore test document.');
    expect(restored.data.status).toBe('published');
    expect(await getPublicPost(`cms-snapshot-${runId}`)).toMatchObject({ title: '发布版本标题' });

    state.user = author;
    expect(await getAdminDocument(postId)).not.toBeNull();
  });

  it('lets an editor withdraw a retained snapshot from a reviewed revision', async () => {
    const slug = `cms-withdraw-review-${runId}`;
    state.user = author;
    const created = await saveDocument({
      kind: 'post',
      data: data({ slug, title: '可撤回的公开版本', categoryId, tagIds: [tagId] }),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);

    const submitted = await transitionDocument({ id: created.data.id, expectedVersion: 1, action: 'submit' });
    expect(submitted.ok).toBe(true);
    state.user = admin;
    const published = await transitionDocument({ id: created.data.id, expectedVersion: 2, action: 'publish' });
    expect(published.ok).toBe(true);
    if (!published.ok || !published.data) throw new Error('Could not publish withdrawal test document.');

    state.user = author;
    const changed = await saveDocument({
      id: created.data.id,
      kind: 'post',
      expectedVersion: published.data.version,
      data: data({ slug: `${slug}-draft`, title: '待审核的新修订', categoryId: replacementCategoryId, tagIds: [replacementTagId] }),
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) throw new Error(changed.error);
    const reviewed = await transitionDocument({ id: created.data.id, expectedVersion: changed.data.version, action: 'submit' });
    expect(reviewed).toMatchObject({ ok: true, data: { status: 'review' } });
    expect(await getPublicPost(slug)).toMatchObject({ title: '可撤回的公开版本' });

    state.user = admin;
    const withdrawn = await transitionDocument({ id: created.data.id, expectedVersion: reviewed.ok && reviewed.data ? reviewed.data.version : 0, action: 'unpublish' });
    expect(withdrawn).toMatchObject({ ok: true, data: { status: 'draft', published: null } });
    expect(await getPublicPost(slug)).toBeNull();
  });
});
