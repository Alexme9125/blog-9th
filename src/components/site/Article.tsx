import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { PublicPost } from "@/lib/content/types";
import { RichText, headingId, nodeText } from "./RichText";
import { PostCard, dateLabel } from "./PostCard";
import styles from "./Article.module.css";
import site from "./Site.module.css";
export function Article({
  post,
  related = [],
  preview = false,
}: {
  post: PublicPost;
  related?: PublicPost[];
  preview?: boolean;
}) {
  const headings =
    post.body.content
      ?.filter((n) => n.type === "heading")
      .map((n, i) => ({ text: nodeText(n), id: headingId(nodeText(n), i) })) ||
    [];
  const toc = (
    <nav aria-label="文章目录">
      {headings.map((h) => (
        <a key={h.id} href={"#" + h.id}>
          {h.text}
        </a>
      ))}
    </nav>
  );
  return (
    <>
      {preview && (
        <div className={styles.previewBanner}>
          草稿预览 · 此版本尚未公开发布
        </div>
      )}
      <main id="main" className="container">
        <header className={styles.header}>
          <div className={styles.breadcrumb}>
            <Link href="/">首页</Link>
            <span>/</span>
            <Link href="/search">社团刊物</Link>
            <span>/</span>
            <span>{post.category?.name || "文章"}</span>
          </div>
          {post.category && (
            <Link
              href={"/category/" + post.category.slug}
              className={styles.category}
            >
              {post.category.name} ↗
            </Link>
          )}
          <h1>{post.title}</h1>
          <p className={styles.excerpt}>{post.excerpt}</p>
          <div className={styles.meta}>
            <span>{post.author.name}</span>
            <span>·</span>
            <time dateTime={post.publishedAt}>
              {dateLabel(post.publishedAt)}
            </time>
            <span>约 {post.readingMinutes} 分钟</span>
          </div>
        </header>
        <div className={styles.articleLayout}>
          <article className={styles.body}>
            {post.coverUrl && (
              <div className={styles.cover}>
                <Image
                  unoptimized
                  src={post.coverUrl}
                  alt={post.coverAlt}
                  fill
                  sizes="(max-width: 700px) 100vw, 760px"
                  priority
                />
              </div>
            )}
            {headings.length > 0 && (
              <details className={styles.mobileToc}>
                <summary>本文目录</summary>
                {toc}
              </details>
            )}
            {post.demo && (
              <div className={styles.demo}>
                示例文章 · 用于展示网站排版与阅读体验，不代表社团真实活动记录。
              </div>
            )}
            <RichText doc={post.body} />
            <div className={styles.tags}>
              {post.tags.map((t) => (
                <Link key={t.id} href={"/tag/" + t.slug}>
                  # {t.name}
                </Link>
              ))}
            </div>
          </article>
          {headings.length > 0 && (
            <aside className={styles.toc}>
              <span>IN THIS ARTICLE</span>
              {toc}
            </aside>
          )}
        </div>
        {related.length > 0 && (
          <section className={styles.related}>
            <div className={styles.relatedHeading}>
              <h2>沿着好奇，继续阅读。</h2>
              <Link href="/search" className="text-link">
                全部文章
                <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className={site.postGrid}>
              {related.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
