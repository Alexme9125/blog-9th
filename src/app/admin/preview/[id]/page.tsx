import { notFound, redirect } from "next/navigation";
import { getAdminDocument } from "@/lib/cms/documents";
import { getTaxonomy } from "@/lib/cms/taxonomy";
import { getMembers, getSiteSettings } from "@/lib/content/public";
import { requireUser } from "@/lib/auth/session";
import { Article } from "@/components/site/Article";
import { PageBlocks } from "@/components/site/PageBlocks";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import styles from "@/components/site/Site.module.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "草稿预览",
  robots: { index: false, follow: false },
};
export default async function Preview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/admin/password");
  const { id } = await params;
  const doc = await getAdminDocument(id);
  if (!doc) notFound();
  const [settings, taxonomy, members] = await Promise.all([
    getSiteSettings(),
    getTaxonomy(),
    getMembers(),
  ]);
  const d = doc.draft;
  return (
    <div id="top">
      <Header settings={settings} />
      {doc.kind === "post" ? (
        <Article
          preview
          post={{
            id: doc.id,
            slug: d.slug,
            title: d.title,
            excerpt: d.excerpt,
            body: d.body,
            coverUrl: d.coverUrl,
            coverAlt: d.coverAlt,
            category:
              taxonomy.categories.find((c) => c.id === d.categoryId) || null,
            tags: taxonomy.tags.filter((t) => d.tagIds.includes(t.id)),
            author: { id: doc.authorId, name: doc.authorName },
            publishedAt: doc.publishedAt || doc.updatedAt,
            readingMinutes: Math.max(
              1,
              Math.ceil(JSON.stringify(d.body).length / 700),
            ),
            featured: d.featured,
          }}
        />
      ) : (
        <>
          <div
            style={{
              textAlign: "center",
              padding: 14,
              background: "var(--cool)",
              fontSize: 13,
            }}
          >
            草稿预览 · 此版本尚未公开发布
          </div>
          <main id="main" className={"container " + styles.pageContent}>
            <header className={styles.pageHeader}>
              <h1>{d.title}</h1>
              <p>{d.description}</p>
            </header>
            <PageBlocks blocks={d.blocks} members={members} />
          </main>
        </>
      )}
      <Footer settings={settings} />
    </div>
  );
}
