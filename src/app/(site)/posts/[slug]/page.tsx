import { notFound } from "next/navigation";
import { getPublicPost, getPublicPosts } from "@/lib/content/public";
import { Article } from "@/components/site/Article";
export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPublicPost(slug);
  if (!post) notFound();
  const { posts } = await getPublicPosts({ limit: 4 });
  return (
    <Article
      post={post}
      related={posts.filter((p) => p.id !== post.id).slice(0, 2)}
    />
  );
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const p = await getPublicPost(slug);
  return {
    title: p?.title || "文章不存在",
    description: p?.excerpt,
    alternates: { canonical: "/posts/" + slug },
    openGraph: p
      ? {
          title: p.title,
          description: p.excerpt,
          type: "article",
          publishedTime: p.publishedAt,
          images: p.coverUrl ? [p.coverUrl] : [],
        }
      : undefined,
  };
}
