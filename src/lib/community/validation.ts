import { z } from 'zod';

const emailSchema = z.string().trim().max(254, '请输入有效的邮箱地址。').email('请输入有效的邮箱地址。').transform((value) => value.toLowerCase());
const honeypotSchema = z.string().max(300, '提交内容无效。').optional();

export const subscribeInputSchema = z
  .object({
    email: emailSchema,
    consent: z.literal(true, { error: '请先同意隐私政策。' }),
    website: honeypotSchema,
  })
  .strict();

const interestsSchema = z
  .union([
    z.string().trim().min(1, '请填写兴趣方向。').max(300, '兴趣方向不能超过 300 个字符。'),
    z.array(z.string().trim().min(1, '请填写兴趣方向。').max(100, '单项兴趣不能超过 100 个字符。')).min(1).max(12),
  ])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export const applicationInputSchema = z
  .object({
    name: z.string().trim().min(1, '请填写姓名或称呼。').max(80, '姓名或称呼不能超过 80 个字符。'),
    email: emailSchema,
    interests: interestsSchema,
    introduction: z.string().trim().min(1, '请填写自我介绍。').max(5_000, '自我介绍不能超过 5000 个字符。'),
    consent: z.literal(true, { error: '请先同意隐私政策。' }),
    website: honeypotSchema,
  })
  .strict();

export const actionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,200}$/, '确认链接无效。');
export const communityIdSchema = z.string().uuid('记录标识无效。');
export const applicationStatusSchema = z.enum(['pending', 'reviewing', 'accepted', 'declined', 'withdrawn']);

/** Broad call-site contracts; each action still validates these untrusted fields with Zod. */
export type SubscribeInput = { email: unknown; consent: boolean; website?: unknown };
export type ApplicationInput = {
  name: unknown;
  email: unknown;
  interests: unknown;
  introduction: unknown;
  consent: boolean;
  website?: unknown;
};
