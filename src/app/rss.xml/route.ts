import { getPublicPosts, getSiteSettings } from "@/lib/content/public";
import { getEffectivePublicUrl } from "@/lib/site-access/store";

export const dynamic = "force-dynamic";
const escape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );

export async function GET() {
  const [settings, { posts }] = await Promise.all([
    getSiteSettings(),
    getPublicPosts({ limit: 100 }),
  ]);
  const origin = await getEffectivePublicUrl();
  const items = posts
    .map(
      (p) =>
        `<item><title>${escape(p.title)}</title><link>${escape(origin)}/posts/${p.slug}</link><guid>${escape(origin)}/posts/${p.slug}</guid><description>${escape(p.excerpt)}</description><pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate></item>`,
    )
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escape(settings.name)}</title><link>${escape(origin)}</link><description>${escape(settings.slogan)}</description><language>zh-CN</language>${items}</channel></rss>`,
    {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
