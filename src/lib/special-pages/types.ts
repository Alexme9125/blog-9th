import type { RichNode } from '@/lib/content/types';

/** Fixed, canonical pages that are managed independently from ordinary CMS documents. */
export const SPECIAL_PAGE_KEYS = ['privacy', 'about'] as const;

export type SpecialPageKey = (typeof SPECIAL_PAGE_KEYS)[number];

/** A separate settings record leaves ordinary site settings and legacy CMS pages untouched. */
export const SPECIAL_PAGE_SETTINGS_KEY = 'special-pages:v1';

export const SPECIAL_PAGE_TITLES: Record<SpecialPageKey, string> = {
  privacy: '隐私政策',
  about: '关于 Darwin动漫社',
};

export type SpecialPageContent = {
  intro: string;
  body: RichNode;
};

export type AdminSpecialPage = {
  key: SpecialPageKey;
  title: string;
  draft: SpecialPageContent;
  published: SpecialPageContent | null;
  /** Starts at zero until this page has first been saved. */
  version: number;
  updatedAt: string | null;
  publishedAt: string | null;
};

export type SaveSpecialPageInput = {
  key: SpecialPageKey;
  expectedVersion: number;
  intro: string;
  body: RichNode;
};

export type PublishSpecialPageInput = {
  key: SpecialPageKey;
  expectedVersion: number;
};

export type PublicSpecialPage = {
  key: SpecialPageKey;
  title: string;
  intro: string;
  body: RichNode;
  /** Null means the safe built-in copy is being shown until an editor publishes a version. */
  publishedAt: string | null;
};

export function isSpecialPageKey(value: unknown): value is SpecialPageKey {
  return typeof value === 'string' && (SPECIAL_PAGE_KEYS as readonly string[]).includes(value);
}
