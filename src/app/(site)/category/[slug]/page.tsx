import { notFound } from "next/navigation";
import { getPublicPosts, getCategories } from "@/lib/content/public";
import { Listing } from "@/components/site/Listing";
import styles from "@/components/site/Site.module.css";
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const category = (await getCategories()).find((c) => c.slug === slug);
  if (!category) notFound();
  const { page } = await searchParams;
  const result = await getPublicPosts({
    category: slug,
    page: Number(page) || 1,
  });
  return (
    <main id="main" className={"container " + styles.pageContent}>
      <header className={styles.pageHeader}>
        <span className="eyebrow">A FIELD OF CURIOSITY</span>
        <h1>{category.name}</h1>
        <p>{category.description || "沿着共同的好奇心，继续探索。"}</p>
      </header>
      <Listing result={result} baseUrl={"/category/" + slug} />
    </main>
  );
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const c = (await getCategories()).find((c) => c.slug === slug);
  return { title: c?.name || "分类" };
}
