import 'server-only';

import type { DocumentData } from '@/lib/cms/types';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function escapeMultilineHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function safeHeaderText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function linkHtml(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
}

export function subscriptionConfirmationMessage(url: string) {
  return {
    subject: '请确认订阅 Darwin 动漫社刊物',
    text: `你正在订阅 Darwin 动漫社刊物。请在 48 小时内打开以下链接确认：\n${url}\n\n如果不是你本人提交，可以忽略这封邮件。`,
    html: `<p>你正在订阅 Darwin 动漫社刊物。</p><p>${linkHtml(url, '确认订阅')}</p><p>如果不是你本人提交，可以忽略这封邮件。</p>`,
  };
}

export function applicationVerificationMessage(url: string) {
  return {
    subject: '请确认你的 Darwin 入社申请邮箱',
    text: `请在 48 小时内打开以下链接，确认邮箱后再将申请提交给社团：\n${url}\n\n为保护你的隐私，这封邮件不包含申请内容。`,
    html: `<p>请在 48 小时内${linkHtml(url, '确认邮箱并提交申请')}。</p><p>为保护你的隐私，这封邮件不包含申请内容。</p>`,
  };
}

export function postMessage(snapshot: DocumentData, url: string, unsubscribeUrl: string) {
  const title = snapshot.title.trim();
  const excerpt = snapshot.excerpt.trim() || snapshot.description.trim();
  return {
    subject: `Darwin 动漫社：${safeHeaderText(title)}`,
    text: `${title}\n\n${excerpt}\n\n阅读原文：${url}\n\n退订：${unsubscribeUrl}`,
    html: `<h1>${escapeHtml(title)}</h1><p>${escapeMultilineHtml(excerpt)}</p><p>${linkHtml(url, '阅读原文')}</p><hr><p>${linkHtml(unsubscribeUrl, '取消订阅')}</p>`,
  };
}

type ApplicationMail = { name: string; email: string; interests: string[]; introduction: string };

function applicationText(application: ApplicationMail): string {
  return `姓名 / 称呼：${application.name}\n邮箱：${application.email}\n兴趣方向：${application.interests.join('、')}\n\n自我介绍：\n${application.introduction}`;
}

function applicationHtml(application: ApplicationMail): string {
  return `<dl><dt>姓名 / 称呼</dt><dd>${escapeHtml(application.name)}</dd><dt>邮箱</dt><dd>${escapeHtml(application.email)}</dd><dt>兴趣方向</dt><dd>${escapeHtml(application.interests.join('、'))}</dd></dl><h2>自我介绍</h2><p>${escapeMultilineHtml(application.introduction)}</p>`;
}

export function applicationCopyMessage(application: ApplicationMail) {
  return {
    subject: '你的 Darwin 入社申请副本',
    text: `我们已收到你的申请。提交申请不代表已获准入社。\n\n${applicationText(application)}`,
    html: `<p>我们已收到你的申请。提交申请不代表已获准入社。</p>${applicationHtml(application)}`,
  };
}

export function applicationNotificationMessage(application: ApplicationMail) {
  return {
    subject: '新的 Darwin 入社申请',
    text: `收到一份已验证邮箱的入社申请。\n\n${applicationText(application)}`,
    html: `<p>收到一份已验证邮箱的入社申请。</p>${applicationHtml(application)}`,
  };
}
