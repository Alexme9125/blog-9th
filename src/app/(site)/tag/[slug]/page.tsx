import { notFound } from "next/navigation";
import { getPublicPosts, getTags } from "@/lib/content/public";
import { Listing } from "@/components/site/Listing";
import styles from "@/components/site/Site.module.css";
export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const tag = (await getTags()).find((c) => c.slug === slug);
  if (!tag) notFound();
  const { page } = await searchParams;
  const result = await getPublicPosts({ tag: slug, page: Number(page) || 1 });
  return (
    <main id="main" className={"container " + styles.pageContent}>
      <header className={styles.pageHeader}>
        <span className="eyebrow">CONNECTED IDEAS</span>
        <h1># {tag.name}</h1>
        <p>有关这个话题的记录与思考。</p>
      </header>
      <Listing result={result} baseUrl={"/tag/" + slug} />
    </main>
  );
}
