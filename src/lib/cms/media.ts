'use server';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import sharp, { type Metadata } from 'sharp';

import type { ActionResult, AdminUser, MediaItem } from './types';
import { assertDatabase, canEditAll, safeActionError } from './internal';
import { ValidationError, getMediaIdFromUrl, sanitizeUploadFilename } from './validation';
import { getSessionUser, requireMutationUser, requireUser } from '@/lib/auth/server';
import { db } from '@/lib/db';
import { auditLog, documents, media, members, revisions } from '@/lib/db/schema';
import { getSpecialPageMediaReferences } from '@/lib/special-pages/store';

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_UPLOAD_PIXELS = 36_000_000;
const mediaFormats = {
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  png: { mimeType: 'image/png', extension: 'png' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
  avif: { mimeType: 'image/avif', extension: 'avif' },
} as const;

type SupportedFormat = keyof typeof mediaFormats;
type StoredMedia = typeof media.$inferSelect;

function failure<T = undefined>(error: string, code?: string): ActionResult<T> {
  return { ok: false, error, ...(code ? { code } : {}) };
}

function ensureMediaId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new ValidationError('媒体 ID 不正确。');
  }
  return value;
}

function mediaDirectory(): string {
  // Uploads live in a runtime volume, never in the compiled application bundle.
  return resolve(/* turbopackIgnore: true */ process.env.MEDIA_DIR?.trim() || process.env.MEDIA_ROOT?.trim() || 'data/uploads');
}

function mediaPath(storageKey: string): string {
  if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp|avif)$/i.test(storageKey)) throw new ValidationError('媒体存储键不正确。');
  const root = mediaDirectory();
  const target = resolve(root, storageKey);
  if (!target.startsWith(`${root}${sep}`)) throw new ValidationError('媒体路径不正确。');
  return target;
}

function toMediaItem(row: StoredMedia): MediaItem {
  return {
    id: row.id,
    url: `/api/media/${row.id}`,
    filename: row.filename,
    alt: row.alt,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    size: row.size,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
  };
}

function referencesUrl(value: unknown, url: string): boolean {
  if (value === url) return true;
  if (Array.isArray(value)) return value.some((item) => referencesUrl(item, url));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((item) => referencesUrl(item, url));
}

async function findMedia(id: string): Promise<StoredMedia | null> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row ?? null;
}

async function isPublicMediaUrl(url: string): Promise<boolean> {
  const [documentRows, memberRows, specialPages] = await Promise.all([
    db
      .select({ published: documents.published })
      .from(documents)
      .where(
        and(
          isNotNull(documents.published),
          isNotNull(documents.publishedSlug),
          isNotNull(documents.publishedAt),
          isNull(documents.deletedAt),
          ne(documents.status, 'archived'),
        ),
      ),
    db.select({ avatarUrl: members.avatarUrl, links: members.links }).from(members),
    getSpecialPageMediaReferences(),
  ]);
  return (
    documentRows.some((document) => referencesUrl(document.published, url)) ||
    memberRows.some((member) => member.avatarUrl === url || referencesUrl(member.links, url)) ||
    specialPages.published.some((body) => referencesUrl(body, url))
  );
}

async function normalizeImage(file: File): Promise<{ data: Buffer; format: SupportedFormat; width: number; height: number }> {
  if (file.size <= 0) throw new ValidationError('请选择一个图片文件。');
  if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError('图片不能超过 12 MB。');
  const source = Buffer.from(await file.arrayBuffer());
  let metadata: Metadata;
  try {
    metadata = await sharp(source, { limitInputPixels: MAX_UPLOAD_PIXELS, failOn: 'error' }).metadata();
  } catch {
    throw new ValidationError('文件不是可读取的图片。');
  }
  const format = metadata.format as SupportedFormat | undefined;
  if (!format || !(format in mediaFormats)) throw new ValidationError('仅支持 JPEG、PNG、WebP 或 AVIF 图片。');
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_UPLOAD_PIXELS) {
    throw new ValidationError('图片尺寸不能超过 3600 万像素。');
  }
  if ((metadata.pages ?? 1) > 1) throw new ValidationError('不支持动画或多页图片。');

  try {
    const pipeline = sharp(source, { limitInputPixels: MAX_UPLOAD_PIXELS, failOn: 'error' }).rotate();
    const encoded =
      format === 'jpeg'
        ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true })
        : format === 'png'
          ? await pipeline.png().toBuffer({ resolveWithObject: true })
          : format === 'webp'
            ? await pipeline.webp({ quality: 90 }).toBuffer({ resolveWithObject: true })
            : await pipeline.avif({ quality: 70 }).toBuffer({ resolveWithObject: true });
    if (encoded.data.length > MAX_UPLOAD_BYTES) throw new ValidationError('处理后的图片仍超过 12 MB。');
    if (encoded.info.width * encoded.info.height > MAX_UPLOAD_PIXELS) throw new ValidationError('图片尺寸不能超过 3600 万像素。');
    return { data: encoded.data, format, width: encoded.info.width, height: encoded.info.height };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('图片无法安全解码。');
  }
}

async function writeUpload(data: Buffer, format: SupportedFormat): Promise<{ storageKey: string; path: string }> {
  const directory = mediaDirectory();
  await mkdir(directory, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const storageKey = `${randomUUID()}.${mediaFormats[format].extension}`;
    const path = mediaPath(storageKey);
    try {
      await writeFile(path, data, { flag: 'wx' });
      return { storageKey, path };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('Could not allocate media storage.');
}

async function removeStoredFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT')) {
      throw error;
    }
  }
}

export async function getMedia(): Promise<MediaItem[]> {
  const user = await requireUser();
  assertDatabase();
  const rows = canEditAll(user)
    ? await db.select().from(media).orderBy(desc(media.createdAt))
    : await db.select().from(media).where(eq(media.ownerId, user.id)).orderBy(desc(media.createdAt));
  return rows.map(toMediaItem);
}

export async function uploadMedia(formData: FormData): Promise<ActionResult<MediaItem>> {
  const user = await requireMutationUser();
  assertDatabase();
  let createdPath: string | null = null;
  try {
    if (!(formData instanceof FormData)) throw new ValidationError('上传表单不正确。');
    const files = formData.getAll('file');
    if (files.length !== 1 || !(files[0] instanceof File)) throw new ValidationError('请选择一个图片文件。');
    const altValue = formData.get('alt');
    if (altValue !== null && typeof altValue !== 'string') throw new ValidationError('图片替代文本不正确。');
    const alt = (altValue ?? '').trim();
    if (alt.length > 500) throw new ValidationError('图片替代文本不能超过 500 个字符。');
    const file = files[0];
    const normalized = await normalizeImage(file);
    const stored = await writeUpload(normalized.data, normalized.format);
    createdPath = stored.path;
    const [row] = await db
      .insert(media)
      .values({
        ownerId: user.id,
        filename: sanitizeUploadFilename(file.name),
        storageKey: stored.storageKey,
        mimeType: mediaFormats[normalized.format].mimeType,
        width: normalized.width,
        height: normalized.height,
        size: normalized.data.length,
        alt,
      })
      .returning();
    if (!row) throw new Error('Could not save media metadata.');
    await db.insert(auditLog).values({ actorId: user.id, action: 'media.upload', resourceId: row.id, detail: { mimeType: row.mimeType } });
    createdPath = null;
    return { ok: true, data: toMediaItem(row) };
  } catch (error) {
    if (createdPath) {
      try {
        await removeStoredFile(createdPath);
      } catch {
        // The database insert failed, and an orphan can be safely cleaned during media maintenance.
      }
    }
    const result = safeActionError(error, '上传图片失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}

export async function deleteMedia(id: string): Promise<ActionResult> {
  const user = await requireMutationUser();
  assertDatabase();
  try {
    const mediaId = ensureMediaId(id);
    const item = await findMedia(mediaId);
    if (!item) return failure('媒体文件不存在。', 'NOT_FOUND');
    if (!canEditAll(user) && item.ownerId !== user.id) return failure('你没有删除此媒体文件的权限。', 'FORBIDDEN');
    const url = `/api/media/${mediaId}`;
    const [documentRows, revisionRows, memberRows, specialPages] = await Promise.all([
      db.select({ draft: documents.draft, published: documents.published }).from(documents),
      db.select({ data: revisions.data }).from(revisions),
      db.select({ avatarUrl: members.avatarUrl, links: members.links }).from(members),
      getSpecialPageMediaReferences(),
    ]);
    if (
      documentRows.some((document) => referencesUrl(document.draft, url) || referencesUrl(document.published, url)) ||
      revisionRows.some((revision) => referencesUrl(revision.data, url)) ||
      memberRows.some((member) => member.avatarUrl === url || referencesUrl(member.links, url)) ||
      specialPages.all.some((body) => referencesUrl(body, url))
    ) {
      return failure('该媒体文件仍被内容引用，无法删除。', 'REFERENCED');
    }
    const [deleted] = await db.delete(media).where(eq(media.id, mediaId)).returning({ id: media.id });
    if (!deleted) return failure('媒体文件不存在。', 'NOT_FOUND');
    await db.insert(auditLog).values({ actorId: user.id, action: 'media.delete', resourceId: mediaId, detail: {} });
    await removeStoredFile(mediaPath(item.storageKey));
    return { ok: true, data: undefined };
  } catch (error) {
    const result = safeActionError(error, '删除媒体文件失败，请稍后重试。');
    return failure(result.error, result.code);
  }
}

/** Route-handler helper. Publicly referenced media is readable anonymously; all other media is private. */
export async function readMediaForRequest(id: string): Promise<
  | { ok: true; bytes: Uint8Array; item: MediaItem; public: boolean }
  | { ok: false; status: 401 | 403 | 404 }
> {
  assertDatabase();
  try {
    const mediaId = ensureMediaId(id);
    const item = await findMedia(mediaId);
    if (!item) return { ok: false, status: 404 };
    const publicUrl = `/api/media/${mediaId}`;
    const isPublic = await isPublicMediaUrl(publicUrl);
    let user: AdminUser | null = null;
    if (!isPublic) user = await getSessionUser();
    if (!isPublic && !user) return { ok: false, status: 401 };
    if (!isPublic && !canEditAll(user!) && item.ownerId !== user!.id) return { ok: false, status: 403 };
    try {
      const bytes = await readFile(/* turbopackIgnore: true */ mediaPath(item.storageKey));
      return { ok: true, bytes: new Uint8Array(bytes), item: toMediaItem(item), public: isPublic };
    } catch {
      return { ok: false, status: 404 };
    }
  } catch {
    return { ok: false, status: 404 };
  }
}

export async function getMediaItemByUrl(url: string): Promise<MediaItem | null> {
  const id = getMediaIdFromUrl(url);
  if (!id) return null;
  // This export can be invoked as a server action. Reuse the route's full read
  // authorization check so a caller cannot enumerate private media metadata.
  const result = await readMediaForRequest(id);
  return result.ok ? result.item : null;
}
