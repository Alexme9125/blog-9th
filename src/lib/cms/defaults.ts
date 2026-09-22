import type { SiteSettings } from '@/lib/content/types';

/** Safe values for an empty installation before an administrator saves site settings. */
export const defaultSiteSettings: SiteSettings = {
  name: 'Darwin动漫社',
  slogan: '用科学与人文创造幻想中的未来',
  description: '一处连接想象与求知的交汇点。',
  footer: '保持好奇，让想象发生。',
  membersIntro: '因为不同的好奇心，我们走到一起。',
  navigation: [
    { id: 'home', label: '首页', href: '/', visible: true, order: 0, fixed: true },
    { id: 'journal', label: '社团刊物', href: '/search', visible: true, order: 1 },
    { id: 'members', label: '主要成员', href: '/members', visible: true, order: 2, fixed: true },
    { id: 'about', label: '关于我们', href: '/pages/about', visible: false, order: 3 },
  ],
};

export const SITE_SETTINGS_KEY = 'site';
