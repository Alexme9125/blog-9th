import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Hero } from "@/components/site/Hero";
import { PostCard } from "@/components/site/PostCard";
import { MarginGeometry } from "@/components/site/MarginGeometry";
import {
  getCategories,
  getPublicPosts,
  getSiteSettings,
} from "@/lib/content/public";
import styles from "@/components/site/Site.module.css";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const q = await searchParams;
  const [settings, categories, result] = await Promise.all([
    getSiteSettings(),
    getCategories(),
    getPublicPosts({
      category: q.category,
      page: Number(q.page) || 1,
      limit: 8,
    }),
  ]);
  return (
    <main id="main">
      <Hero
        slogan={settings.slogan}
        name={settings.name}
        description={settings.description}
      />
      <section id="journal" className={styles.journalSection}>
        <MarginGeometry variant="journal" />
        <div className={`container ${styles.journal}`}>
          <div className={styles.sectionHeading}>
            <div>
              <span className="eyebrow">THE JOURNAL</span>
              <h2>
                此刻，我们在想什么<span>。</span>
              </h2>
            </div>
            <Link className="text-link" href="/search">
              全部文章
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className={styles.filterBar}>
            <nav aria-label="文章分类">
              <Link
                href="/#journal"
                className={!q.category ? styles.filterActive : ""}
              >
                全部
              </Link>
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/?category=${c.slug}#journal`}
                  className={q.category === c.slug ? styles.filterActive : ""}
                >
                  {c.name}
                </Link>
              ))}
            </nav>
            <span>{String(result.total).padStart(2, "0")} 篇记录</span>
          </div>
          {result.posts.length ? (
            <div className={styles.postGrid}>
              {result.posts.map((p, i) => (
                <PostCard key={p.id} post={p} index={i} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h3>新的记录，正在酝酿。</h3>
              <p>这里还没有已发布的文章，稍后再来看看。</p>
            </div>
          )}
          {result.pages > 1 && (
            <nav className="pagination" aria-label="分页">
              {Array.from({ length: result.pages }, (_, i) => (
                <Link
                  key={i}
                  aria-current={result.page === i + 1 ? "page" : undefined}
                  href={`/?page=${i + 1}${q.category ? `&category=${q.category}` : ""}#journal`}
                >
                  {i + 1}
                </Link>
              ))}
            </nav>
          )}
          <div className={styles.journalEnd}>
            <span>每一种好奇，都值得被认真记录。</span>
            <span>END OF THIS PAGE / KEEP EXPLORING</span>
          </div>
        </div>
      </section>
    </main>
  );
}
