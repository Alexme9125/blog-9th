import type { MetadataRoute } from "next";
import { getEffectivePublicUrl } from "@/lib/site-access/store";
import {
  getCategories,
  getPublicPages,
  getPublicPosts,
  getTags,
} from "@/lib/content/public";

export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await getEffectivePublicUrl();
  const [first, pages, categories, tags] = await Promise.all([
    getPublicPosts({ limit: 100 }),
    getPublicPages(),
    getCategories(),
    getTags(),
  ]);
  const posts = [...first.posts];
  for (let page = 2; page <= first.pages; page++)
    posts.push(...(await getPublicPosts({ limit: 100, page })).posts);
  return [
    ...["", "/members", "/search"].map((path) => ({ url: origin + path })),
    ...posts.map((post) => ({
      url: `${origin}/posts/${post.slug}`,
      lastModified: post.publishedAt,
    })),
    ...pages.map((page) => ({
      url: `${origin}/pages/${page.slug}`,
      lastModified: page.publishedAt,
    })),
    ...categories.map((c) => ({ url: `${origin}/category/${c.slug}` })),
    ...tags.map((t) => ({ url: `${origin}/tag/${t.slug}` })),
  ];
}
