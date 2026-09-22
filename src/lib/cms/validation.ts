import type {
  DocumentData,
  DocumentKind,
  MemberInput,
  SaveTaxonomyInput,
  SettingsInput,
} from './types';
import type { NavigationItem, PageBlock, RichNode } from '@/lib/content/types';

const MAX_RICH_TEXT_NODES = 4_000;
const MAX_RICH_TEXT_DEPTH = 32;
const MAX_RICH_TEXT_TEXT = 120_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEDIA_PATH_PATTERN = /^\/api\/media\/([A-Za-z0-9][A-Za-z0-9-]{0,127})$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

type ValidationOptions = {
  allowSeedFixtures?: boolean;
  allowDemo?: boolean;
};

function fail(message: string): never {
  throw new ValidationError(message);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(`${label} 必须是对象。`);
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} 包含不支持的字段：${key}。`);
  }
}

function stringValue(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; trim?: boolean } = {},
): string {
  if (typeof value !== 'string') fail(`${label} 必须是文本。`);
  const normalized = options.trim === false ? value : value.trim();
  if (options.min !== undefined && normalized.length < options.min) fail(`${label} 不能为空。`);
  if (options.max !== undefined && normalized.length > options.max) fail(`${label} 不能超过 ${options.max} 个字符。`);
  return normalized;
}

function optionalString(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, label, { max });
}

/** Tiptap serializes several optional extension attributes as null. */
function nullableOptionalString(value: unknown, label: string, max: number): string | undefined {
  return value === null ? undefined : optionalString(value, label, max);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是布尔值。`);
  return value;
}

function integerValue(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < min || value > max) {
    fail(`${label} 必须是 ${min} 到 ${max} 之间的整数。`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  const id = stringValue(value, label, { min: 1, max: 128 });
  if (!ID_PATTERN.test(id)) fail(`${label} 格式不正确。`);
  return id;
}

function noUnsafeCharacters(value: string): boolean {
  return !/[\u0000-\u001f\u007f\\]/.test(value);
}

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Accepts only links which are safe for Next's Link or a normal anchor. */
export function isSafeHref(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return false;
  const candidate = value.trim();
  if (candidate !== value || !noUnsafeCharacters(candidate)) return false;
  const lowered = candidate.toLowerCase();
  if (lowered.startsWith('javascript:') || lowered.startsWith('data:') || lowered.startsWith('vbscript:')) return false;

  if (candidate.startsWith('#')) return candidate.length > 1;
  if (candidate.startsWith('/')) {
    const unescaped = decoded(candidate);
    return !candidate.startsWith('//') && !!unescaped && !unescaped.startsWith('//') && !unescaped.includes('..');
  }
  if (lowered.startsWith('mailto:')) return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+(?:\?.*)?$/i.test(candidate);

  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Uploaded content always travels through the authenticated media endpoint. */
export function isAllowedMediaUrl(value: unknown, options: ValidationOptions = {}): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  if (!noUnsafeCharacters(value) || value !== value.trim()) return false;
  if (MEDIA_PATH_PATTERN.test(value)) return true;
  return Boolean(options.allowSeedFixtures && process.env.NODE_ENV !== 'production' && /^\/images\/[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(value));
}

export function getMediaIdFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.match(MEDIA_PATH_PATTERN)?.[1] ?? null;
}

type RichTextState = { nodes: number; textLength: number; options: ValidationOptions };

function validateMarks(value: unknown): RichNode['marks'] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16) fail('文本标记格式不正确。');
  return value.map((item) => {
    const mark = object(item, '文本标记');
    exactKeys(mark, ['type', 'attrs'], '文本标记');
    const type = stringValue(mark.type, '文本标记类型', { min: 1, max: 20 });
    if (!['bold', 'italic', 'strike', 'underline', 'code', 'link'].includes(type)) fail(`不支持的文本标记：${type}。`);
    if (type !== 'link') {
      if (mark.attrs !== undefined) fail(`${type} 标记不能包含属性。`);
      return { type };
    }
    const attrs = object(mark.attrs, '链接属性');
    // These are Tiptap's default link attributes. Only href is persisted so
    // presentation attributes cannot alter the public renderer.
    exactKeys(attrs, ['href', 'target', 'rel', 'class', 'title'], '链接属性');
    const href = stringValue(attrs.href, '链接地址', { min: 1, max: 2_048 });
    if (!isSafeHref(href)) fail('链接地址不安全。');
    return { type: 'link', attrs: { href } };
  });
}

function validateNode(value: unknown, state: RichTextState, depth: number): RichNode {
  if (depth > MAX_RICH_TEXT_DEPTH) fail('正文层级过深。');
  state.nodes += 1;
  if (state.nodes > MAX_RICH_TEXT_NODES) fail('正文节点过多。');

  const node = object(value, '正文节点');
  const type = stringValue(node.type, '正文节点类型', { min: 1, max: 40 });
  const content = (children: unknown): RichNode[] | undefined => {
    if (children === undefined) return undefined;
    if (!Array.isArray(children)) fail(`${type} 的内容必须是数组。`);
    return children.map((child) => validateNode(child, state, depth + 1));
  };

  switch (type) {
    case 'doc': {
      exactKeys(node, ['type', 'content'], '文档根节点');
      const children = content(node.content);
      if (!children) fail('文档正文不能为空。');
      return { type, content: children };
    }
    case 'text': {
      exactKeys(node, ['type', 'text', 'marks'], '文本节点');
      const text = stringValue(node.text, '文本内容', { max: 20_000, trim: false });
      state.textLength += text.length;
      if (state.textLength > MAX_RICH_TEXT_TEXT) fail('正文文本过长。');
      const marks = validateMarks(node.marks);
      return marks ? { type, text, marks } : { type, text };
    }
    case 'paragraph':
    case 'bulletList':
    case 'listItem':
    case 'blockquote':
    case 'table':
    case 'tableRow': {
      exactKeys(node, ['type', 'content'], `${type} 节点`);
      const children = content(node.content);
      return children ? { type, content: children } : { type };
    }
    case 'orderedList': {
      exactKeys(node, ['type', 'attrs', 'content'], '有序列表节点');
      const attrs = node.attrs === undefined ? undefined : object(node.attrs, '有序列表属性');
      if (attrs) exactKeys(attrs, ['start', 'type'], '有序列表属性');
      const start = attrs?.start === undefined ? 1 : integerValue(attrs.start, '有序列表起始序号', 1, 100_000);
      const listType = attrs?.type === undefined || attrs?.type === null ? undefined : stringValue(attrs.type, '有序列表类型', { max: 1 });
      if (listType !== undefined && !['1', 'a', 'A', 'i', 'I'].includes(listType)) fail('有序列表类型不正确。');
      const children = content(node.content);
      const normalizedAttrs = start !== 1 || listType !== undefined ? { start, ...(listType ? { type: listType } : {}) } : undefined;
      return { type, ...(normalizedAttrs ? { attrs: normalizedAttrs } : {}), ...(children ? { content: children } : {}) };
    }
    case 'tableHeader':
    case 'tableCell': {
      exactKeys(node, ['type', 'attrs', 'content'], `${type} 节点`);
      const attrs = node.attrs === undefined ? undefined : object(node.attrs, `${type} 属性`);
      if (attrs) exactKeys(attrs, ['colspan', 'rowspan', 'colwidth', 'align'], `${type} 属性`);
      const colspan = attrs?.colspan === undefined ? 1 : integerValue(attrs.colspan, '表格列跨度', 1, 100);
      const rowspan = attrs?.rowspan === undefined ? 1 : integerValue(attrs.rowspan, '表格行跨度', 1, 100);
      let colwidth: number[] | undefined;
      if (attrs?.colwidth !== undefined && attrs.colwidth !== null) {
        if (!Array.isArray(attrs.colwidth) || attrs.colwidth.length === 0 || attrs.colwidth.length > colspan) {
          fail('表格列宽格式不正确。');
        }
        colwidth = attrs.colwidth.map((width) => integerValue(width, '表格列宽', 1, 20_000));
      }
      const align = attrs?.align === undefined || attrs?.align === null ? undefined : stringValue(attrs.align, '表格对齐方式', { max: 6 });
      if (align !== undefined && !['left', 'center', 'right'].includes(align)) fail('表格对齐方式不正确。');
      const children = content(node.content);
      const normalizedAttrs =
        colspan !== 1 || rowspan !== 1 || colwidth !== undefined || align !== undefined
          ? { ...(colspan !== 1 ? { colspan } : {}), ...(rowspan !== 1 ? { rowspan } : {}), ...(colwidth ? { colwidth } : {}), ...(align ? { align } : {}) }
          : undefined;
      return { type, ...(normalizedAttrs ? { attrs: normalizedAttrs } : {}), ...(children ? { content: children } : {}) };
    }
    case 'heading': {
      exactKeys(node, ['type', 'attrs', 'content'], '标题节点');
      const attrs = object(node.attrs, '标题属性');
      exactKeys(attrs, ['level'], '标题属性');
      const level = integerValue(attrs.level, '标题级别', 1, 4);
      const children = content(node.content);
      return { type, attrs: { level }, content: children };
    }
    case 'codeBlock': {
      exactKeys(node, ['type', 'attrs', 'content'], '代码块');
      const attrs = node.attrs === undefined ? undefined : object(node.attrs, '代码块属性');
      if (attrs) exactKeys(attrs, ['language'], '代码块属性');
      const language = nullableOptionalString(attrs?.language, '代码语言', 64);
      if (language && !/^[A-Za-z0-9_+.-]+$/.test(language)) fail('代码语言格式不正确。');
      const children = content(node.content);
      return { type, ...(language ? { attrs: { language } } : {}), content: children };
    }
    case 'hardBreak':
    case 'horizontalRule': {
      exactKeys(node, ['type'], `${type} 节点`);
      return { type };
    }
    case 'image': {
      exactKeys(node, ['type', 'attrs'], '图片节点');
      const attrs = object(node.attrs, '图片属性');
      exactKeys(attrs, ['src', 'alt', 'title', 'width', 'height'], '图片属性');
      const src = stringValue(attrs.src, '图片地址', { min: 1, max: 256 });
      if (!isAllowedMediaUrl(src, state.options)) fail('图片必须使用已上传的媒体文件。');
      const alt = nullableOptionalString(attrs.alt, '图片替代文本', 500);
      const title = nullableOptionalString(attrs.title, '图片说明', 500);
      for (const [key, value] of Object.entries({ width: attrs.width, height: attrs.height })) {
        if (value !== undefined && value !== null) integerValue(value, `图片${key === 'width' ? '宽度' : '高度'}`, 1, 20_000);
      }
      return { type, attrs: { src, ...(alt !== undefined ? { alt } : {}), ...(title !== undefined ? { title } : {}) } };
    }
    case 'inlineMath':
    case 'blockMath': {
      exactKeys(node, ['type', 'attrs'], '公式节点');
      const attrs = object(node.attrs, '公式属性');
      exactKeys(attrs, ['latex'], '公式属性');
      const latex = stringValue(attrs.latex, '公式', { max: 10_000, trim: false });
      return { type, attrs: { latex } };
    }
    default:
      fail(`不支持的正文节点：${type}。`);
  }
}

export function validateRichNode(value: unknown, options: ValidationOptions = {}): RichNode {
  const node = validateNode(value, { nodes: 0, textLength: 0, options }, 0);
  if (node.type !== 'doc') fail('正文必须以 doc 节点开始。');
  return node;
}

function validatePageBlock(value: unknown, options: ValidationOptions): PageBlock {
  const block = object(value, '页面区块');
  const type = stringValue(block.type, '页面区块类型', { min: 1, max: 24 }) as PageBlock['type'];
  if (!['richtext', 'imageText', 'gallery', 'members', 'links'].includes(type)) fail(`不支持的页面区块：${type}。`);
  const id = identifier(block.id, '页面区块 ID');
  const title = optionalString(block.title, '页面区块标题', 160);
  const result: PageBlock = { id, type, ...(title !== undefined ? { title } : {}) };

  if (type === 'richtext') {
    exactKeys(block, ['id', 'type', 'title', 'body'], '富文本区块');
    if (block.body !== undefined) result.body = validateRichNode(block.body, options);
    return result;
  }
  if (type === 'imageText') {
    exactKeys(block, ['id', 'type', 'title', 'body', 'imageUrl', 'imageAlt', 'imageSide'], '图文区块');
    if (block.body !== undefined) result.body = validateRichNode(block.body, options);
    if (block.imageUrl !== undefined) {
      const imageUrl = stringValue(block.imageUrl, '图文图片地址', { min: 1, max: 256 });
      if (!isAllowedMediaUrl(imageUrl, options)) fail('图文图片必须使用已上传的媒体文件。');
      result.imageUrl = imageUrl;
    }
    const imageAlt = optionalString(block.imageAlt, '图文图片替代文本', 500);
    if (imageAlt !== undefined) result.imageAlt = imageAlt;
    if (block.imageSide !== undefined) {
      if (block.imageSide !== 'left' && block.imageSide !== 'right') fail('图文图片位置不正确。');
      result.imageSide = block.imageSide;
    }
    return result;
  }
  if (type === 'gallery') {
    exactKeys(block, ['id', 'type', 'title', 'images'], '画廊区块');
    if (block.images !== undefined) {
      if (!Array.isArray(block.images) || block.images.length > 24) fail('画廊图片数量不正确。');
      result.images = block.images.map((entry) => {
        const image = object(entry, '画廊图片');
        exactKeys(image, ['url', 'alt', 'caption'], '画廊图片');
        const url = stringValue(image.url, '画廊图片地址', { min: 1, max: 256 });
        if (!isAllowedMediaUrl(url, options)) fail('画廊图片必须使用已上传的媒体文件。');
        const alt = stringValue(image.alt, '画廊图片替代文本', { max: 500 });
        const caption = optionalString(image.caption, '画廊图片说明', 500);
        return { url, alt, ...(caption !== undefined ? { caption } : {}) };
      });
    }
    return result;
  }
  if (type === 'members') {
    exactKeys(block, ['id', 'type', 'title', 'memberIds'], '成员区块');
    if (block.memberIds !== undefined) {
      if (!Array.isArray(block.memberIds) || block.memberIds.length > 100) fail('成员区块成员数量不正确。');
      result.memberIds = [...new Set(block.memberIds.map((entry) => identifier(entry, '成员 ID')))];
    }
    return result;
  }

  exactKeys(block, ['id', 'type', 'title', 'links'], '链接区块');
  if (block.links !== undefined) {
    if (!Array.isArray(block.links) || block.links.length > 40) fail('链接数量不正确。');
    result.links = block.links.map((entry) => {
      const link = object(entry, '链接');
      exactKeys(link, ['label', 'url', 'description'], '链接');
      const label = stringValue(link.label, '链接名称', { min: 1, max: 120 });
      const url = stringValue(link.url, '链接地址', { min: 1, max: 2_048 });
      if (!isSafeHref(url)) fail('链接地址不安全。');
      const description = optionalString(link.description, '链接说明', 400);
      return { label, url, ...(description !== undefined ? { description } : {}) };
    });
  }
  return result;
}

export function validateDocumentData(kind: DocumentKind, value: unknown, options: ValidationOptions = {}): DocumentData {
  const data = object(value, '文档数据');
  exactKeys(data, ['slug', 'title', 'excerpt', 'coverUrl', 'coverAlt', 'categoryId', 'tagIds', 'body', 'blocks', 'description', 'featured', 'demo'], '文档数据');
  const slug = stringValue(data.slug, 'URL 标识', { min: 1, max: 120 });
  if (!SLUG_PATTERN.test(slug)) fail('URL 标识只能使用小写字母、数字和连字符。');
  const title = stringValue(data.title, '标题', { min: 1, max: 180 });
  const excerpt = stringValue(data.excerpt, '摘要', { max: 800 });
  const coverUrl = data.coverUrl === null ? null : stringValue(data.coverUrl, '封面地址', { min: 1, max: 256 });
  if (coverUrl !== null && !isAllowedMediaUrl(coverUrl, options)) fail('封面必须使用已上传的媒体文件。');
  const coverAlt = stringValue(data.coverAlt, '封面替代文本', { max: 500 });
  const categoryId = data.categoryId === null ? null : identifier(data.categoryId, '分类 ID');
  if (!Array.isArray(data.tagIds) || data.tagIds.length > 30) fail('标签数量不正确。');
  const tagIds = [...new Set(data.tagIds.map((tag) => identifier(tag, '标签 ID')))];
  const body = validateRichNode(data.body, options);
  if (!Array.isArray(data.blocks) || data.blocks.length > 60) fail('页面区块数量不正确。');
  const blocks = data.blocks.map((block) => validatePageBlock(block, options));
  const blockIds = new Set<string>();
  for (const block of blocks) {
    if (blockIds.has(block.id)) fail('页面区块 ID 不能重复。');
    blockIds.add(block.id);
  }
  const description = stringValue(data.description, '页面描述', { max: 800 });
  const featured = booleanValue(data.featured, '精选状态');
  const demo = data.demo === undefined ? undefined : booleanValue(data.demo, '示例状态');
  if (demo && !options.allowDemo) fail('示例标记只能由开发种子写入。');

  if (kind === 'post' && blocks.length > 0) fail('文章不能包含页面区块。');
  if (kind === 'page' && (categoryId !== null || tagIds.length > 0 || featured)) {
    fail('静态页面不能设置分类、标签或精选状态。');
  }

  return {
    slug,
    title,
    excerpt,
    coverUrl,
    coverAlt,
    categoryId,
    tagIds,
    body,
    blocks,
    description,
    featured,
    ...(demo ? { demo: true } : {}),
  };
}

export function validateTaxonomyInput(value: unknown): SaveTaxonomyInput {
  const input = object(value, '分类或标签');
  exactKeys(input, ['id', 'kind', 'name', 'slug', 'description'], '分类或标签');
  const kind = input.kind;
  if (kind !== 'category' && kind !== 'tag') fail('分类类型不正确。');
  const id = input.id === undefined ? undefined : identifier(input.id, '分类 ID');
  const name = stringValue(input.name, '名称', { min: 1, max: 80 });
  const slug = stringValue(input.slug, 'URL 标识', { min: 1, max: 100 });
  if (!SLUG_PATTERN.test(slug)) fail('URL 标识只能使用小写字母、数字和连字符。');
  const description = optionalString(input.description, '描述', 400);
  return { ...(id ? { id } : {}), kind, name, slug, ...(description !== undefined ? { description } : {}) };
}

export function validateMemberInput(value: unknown, options: ValidationOptions = {}): MemberInput {
  const input = object(value, '成员资料');
  exactKeys(input, ['id', 'name', 'role', 'bio', 'avatarUrl', 'interests', 'links', 'order'], '成员资料');
  const id = input.id === undefined ? undefined : identifier(input.id, '成员 ID');
  const name = stringValue(input.name, '成员姓名', { min: 1, max: 100 });
  const role = stringValue(input.role, '成员角色', { max: 140 });
  const bio = stringValue(input.bio, '成员简介', { max: 1_200 });
  const avatarUrl = input.avatarUrl === null ? null : stringValue(input.avatarUrl, '头像地址', { min: 1, max: 256 });
  if (avatarUrl !== null && !isAllowedMediaUrl(avatarUrl, options)) fail('头像必须使用已上传的媒体文件。');
  if (!Array.isArray(input.interests) || input.interests.length > 24) fail('兴趣标签数量不正确。');
  const interests = [...new Set(input.interests.map((entry) => stringValue(entry, '兴趣标签', { min: 1, max: 50 })))];
  if (!Array.isArray(input.links) || input.links.length > 16) fail('成员链接数量不正确。');
  const links = input.links.map((entry) => {
    const link = object(entry, '成员链接');
    exactKeys(link, ['label', 'url'], '成员链接');
    const label = stringValue(link.label, '成员链接名称', { min: 1, max: 80 });
    const url = stringValue(link.url, '成员链接地址', { min: 1, max: 2_048 });
    if (!isSafeHref(url)) fail('成员链接地址不安全。');
    return { label, url };
  });
  const order = integerValue(input.order, '成员排序', -10_000, 10_000);
  return { ...(id ? { id } : {}), name, role, bio, avatarUrl, interests, links, order };
}

function validateNavigationItem(value: unknown): NavigationItem {
  const item = object(value, '导航项');
  exactKeys(item, ['id', 'label', 'href', 'visible', 'order', 'fixed'], '导航项');
  const id = identifier(item.id, '导航项 ID');
  const label = stringValue(item.label, '导航项名称', { min: 1, max: 80 });
  const href = stringValue(item.href, '导航项地址', { min: 1, max: 2_048 });
  if (!isSafeHref(href)) fail('导航项地址不安全。');
  const visible = booleanValue(item.visible, '导航显示状态');
  const order = integerValue(item.order, '导航排序', -10_000, 10_000);
  const fixed = item.fixed === undefined ? undefined : booleanValue(item.fixed, '导航固定状态');
  return { id, label, href, visible, order, ...(fixed ? { fixed: true } : {}) };
}

export function validateSettingsInput(value: unknown, existingNavigation?: NavigationItem[]): SettingsInput {
  const input = object(value, '站点设置');
  exactKeys(input, ['name', 'slogan', 'description', 'footer', 'membersIntro', 'navigation'], '站点设置');
  const name = stringValue(input.name, '站点名称', { min: 1, max: 120 });
  const slogan = stringValue(input.slogan, '站点标语', { max: 240 });
  const description = stringValue(input.description, '站点描述', { max: 1_000 });
  const footer = stringValue(input.footer, '页脚文案', { max: 500 });
  const membersIntro = stringValue(input.membersIntro, '成员页介绍', { max: 1_000 });
  if (!Array.isArray(input.navigation) || input.navigation.length < 2 || input.navigation.length > 24) {
    fail('导航项数量不正确。');
  }
  const navigation = input.navigation.map(validateNavigationItem);
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const item of navigation) {
    if (ids.has(item.id)) fail('导航项 ID 不能重复。');
    if (orders.has(item.order)) fail('导航排序不能重复。');
    ids.add(item.id);
    orders.add(item.order);
  }
  for (const requiredHref of ['/', '/members']) {
    const item = navigation.find((entry) => entry.href === requiredHref);
    if (!item || !item.fixed || !item.visible) fail(`固定导航 ${requiredHref} 不能删除、隐藏或修改路由。`);
  }
  for (const oldItem of existingNavigation?.filter((item) => item.fixed) ?? []) {
    const nextItem = navigation.find((item) => item.id === oldItem.id);
    if (!nextItem || nextItem.href !== oldItem.href || !nextItem.fixed) {
      fail(`固定导航 ${oldItem.label} 不能删除或修改路由。`);
    }
  }
  return { name, slogan, description, footer, membersIntro, navigation };
}

export function sanitizeUploadFilename(value: string): string {
  const basename = value.split(/[\\/]/).pop()?.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim() || '';
  return basename.slice(0, 180) || 'upload';
}
