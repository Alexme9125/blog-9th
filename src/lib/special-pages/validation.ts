import type { RichNode } from '@/lib/content/types';

import { ValidationError, isPlainObject, validateRichNode } from '@/lib/cms/validation';

import { SPECIAL_PAGE_KEYS, isSpecialPageKey, type PublishSpecialPageInput, type SaveSpecialPageInput, type SpecialPageContent, type SpecialPageKey } from './types';

const MAX_INTRO_LENGTH = 500;

export type StoredSpecialPage = {
  draft: SpecialPageContent;
  published: SpecialPageContent | null;
  version: number;
  updatedAt: string | null;
  publishedAt: string | null;
};

export type StoredSpecialPages = {
  schemaVersion: 1;
  pages: Record<SpecialPageKey, StoredSpecialPage>;
};

function fail(message: string): never {
  throw new ValidationError(message);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} 包含不支持的字段：${key}。`);
  }
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') fail(`${label} 必须是文本。`);
  const normalized = value.trim();
  if (normalized.length > maximum) fail(`${label} 不能超过 ${maximum} 个字符。`);
  return normalized;
}

function specialPageKey(value: unknown): SpecialPageKey {
  if (!isSpecialPageKey(value)) fail('专页标识不正确。');
  return value;
}

export function validateSpecialPageKey(value: unknown): SpecialPageKey {
  return specialPageKey(value);
}

function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > 2_147_483_647) {
    fail('缺少有效的专页版本，请刷新后重试。');
  }
  return value;
}

function timestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') fail(`${label} 必须是 ISO 时间或空值。`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) fail(`${label} 格式不正确。`);
  return value;
}

export function validateSpecialPageContent(value: unknown): SpecialPageContent {
  if (!isPlainObject(value)) fail('专页内容必须是对象。');
  exactKeys(value, ['intro', 'body'], '专页内容');
  const intro = text(value.intro, '专页导语', MAX_INTRO_LENGTH);
  const body = validateRichNode(value.body) as RichNode;
  return { intro, body };
}

export function validateSaveSpecialPageInput(value: unknown): SaveSpecialPageInput {
  if (!isPlainObject(value)) fail('专页保存数据不正确。');
  exactKeys(value, ['key', 'expectedVersion', 'intro', 'body'], '专页保存数据');
  const key = specialPageKey(value.key);
  const expected = expectedVersion(value.expectedVersion);
  const content = validateSpecialPageContent({ intro: value.intro, body: value.body });
  return { key, expectedVersion: expected, ...content };
}

export function validatePublishSpecialPageInput(value: unknown): PublishSpecialPageInput {
  if (!isPlainObject(value)) fail('专页发布数据不正确。');
  exactKeys(value, ['key', 'expectedVersion'], '专页发布数据');
  return { key: specialPageKey(value.key), expectedVersion: expectedVersion(value.expectedVersion) };
}

function validateStoredPage(value: unknown): StoredSpecialPage {
  if (!isPlainObject(value)) fail('专页存储记录不正确。');
  exactKeys(value, ['draft', 'published', 'version', 'updatedAt', 'publishedAt'], '专页存储记录');

  const draft = validateSpecialPageContent(value.draft);
  const published = value.published === null ? null : validateSpecialPageContent(value.published);
  const version = expectedVersion(value.version);
  const updatedAt = timestamp(value.updatedAt, '专页更新时间');
  const publishedAt = timestamp(value.publishedAt, '专页发布时间');

  if (version === 0 && (updatedAt !== null || published !== null || publishedAt !== null)) {
    fail('未保存的专页不能包含发布时间或更新记录。');
  }
  if (version > 0 && updatedAt === null) fail('已保存的专页必须包含更新时间。');
  if ((published === null) !== (publishedAt === null)) fail('专页发布内容和发布时间必须同时存在。');

  return { draft, published, version, updatedAt, publishedAt };
}

export function validateStoredSpecialPages(value: unknown): StoredSpecialPages {
  if (!isPlainObject(value)) fail('专页设置记录不正确。');
  exactKeys(value, ['schemaVersion', 'pages'], '专页设置记录');
  if (value.schemaVersion !== 1) fail('专页设置版本不受支持。');
  if (!isPlainObject(value.pages)) fail('专页设置内容不正确。');
  exactKeys(value.pages, SPECIAL_PAGE_KEYS, '专页设置内容');

  const pages = {} as Record<SpecialPageKey, StoredSpecialPage>;
  for (const key of SPECIAL_PAGE_KEYS) pages[key] = validateStoredPage(value.pages[key]);
  return { schemaVersion: 1, pages };
}
