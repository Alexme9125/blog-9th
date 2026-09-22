import { notFound } from "next/navigation";
import { getPublicPage, getMembers } from "@/lib/content/public";
import { PageBlocks } from "@/components/site/PageBlocks";
import styles from "@/components/site/Site.module.css";
export default async function StaticPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPublicPage(slug);
  if (!page) notFound();
  const members = await getMembers();
  return (
    <main id="main" className={"container " + styles.pageContent}>
      <header className={styles.pageHeader}>
        <span className="eyebrow">DARWIN / COMMUNITY</span>
        <h1>{page.title}</h1>
        {page.description && <p>{page.description}</p>}
      </header>
      <PageBlocks blocks={page.blocks} members={members} />
    </main>
  );
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const p = await getPublicPage(slug);
  return { title: p?.title || "页面", description: p?.description };
}
