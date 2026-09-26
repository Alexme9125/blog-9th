import type { RichNode } from '@/lib/content/types';

import type { SpecialPageContent, SpecialPageKey } from './types';

function paragraph(text: string): RichNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function heading(text: string): RichNode {
  return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] };
}

function document(content: RichNode[]): RichNode {
  return { type: 'doc', content };
}

/**
 * Built-in copy describes the implemented data flows only. It remains editable and is not a
 * legal-compliance claim or a substitute for an administrator's organisation-specific policy.
 */
export function defaultSpecialPageContent(key: SpecialPageKey): SpecialPageContent {
  if (key === 'about') {
    return {
      intro: '用科学与人文创造幻想中的未来',
      body: document([
        heading('我们关心的事'),
        paragraph('Darwin动漫社围绕 ACGN、科学、人文与人工智能等兴趣开展交流。'),
        heading('这个站点'),
        paragraph('这里用于发布社团内容、分享观察，也为希望参与交流的人保留订阅和入社申请入口。'),
      ]),
    };
  }

  return {
    intro: '本说明概述本站当前的订阅、入社申请和后台管理数据处理方式。',
    body: document([
      heading('我们会收集什么'),
      paragraph('订阅时会收集邮箱地址和你的同意时间。入社申请会收集姓名、邮箱地址、兴趣、个人介绍和同意时间。后台登录会处理账户和会话信息。'),
      heading('订阅和邮件'),
      paragraph('订阅需要通过有时限的邮箱确认链接后才会生效；文章通知只会发送给已确认的订阅者。取消订阅需要再次确认，完成后会停止向该地址发送订阅邮件，并保留必要的退订记录。'),
      paragraph('如你提交入社申请，本站会先发送不含申请正文的收件确认。完成邮箱确认后，经配置的发信服务商会投递一份包含你个人申请内容的副本；申请撤回后，尚未投递的副本不会继续发送。'),
      heading('谁能查看'),
      paragraph('入社申请不会公开展示，只由获得授权的管理员和编辑用于审核。为完成邮件投递，必要的收件信息和邮件内容会交由已配置的发信服务商处理。'),
      heading('登录和安全'),
      paragraph('为保障后台登录，本站使用必要的 Cookie。为维护安全和防止滥用，可能记录 IP 地址、浏览器信息和必要的运行或管理记录。'),
      heading('保留和更新'),
      paragraph('社团会按申请处理和运行需要保留相关记录，管理员可以删除审核记录。已由发信服务商送达的邮件副本无法由本站撤回。运营方式、表单或资料处理方式变化时，管理员应更新并发布本政策。'),
    ]),
  };
}
