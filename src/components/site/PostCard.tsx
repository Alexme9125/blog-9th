import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import type { PublicPost } from "@/lib/content/types";
import styles from "./Site.module.css";
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  })
    .format(new Date(date))
    .replaceAll("/", ".");
export function PostCard({
  post,
  index = 0,
}: {
  post: PublicPost;
  index?: number;
}) {
  return (
    <article
      className={`${styles.postCard} ${!post.coverUrl ? styles.textCard : ""}`}
    >
      <Link
        className={styles.cardLink}
        href={`/posts/${post.slug}`}
        aria-label={`阅读：${post.title}`}
      >
        {post.coverUrl && (
          <div className={styles.cover}>
            <Image
              unoptimized
              src={post.coverUrl}
              alt={post.coverAlt}
              fill
              sizes="(max-width: 700px) 100vw, 600px"
              priority={index < 2}
            />
            <span className={styles.coverLabel}>FIELD NOTES / DARWIN</span>
          </div>
        )}
        <div className={styles.cardBody}>
          <div className={styles.cardMeta}>
            <span>{post.category?.name || "社团刊物"}</span>
            <span>{dateLabel(post.publishedAt)}</span>
          </div>
          <h3>{post.title}</h3>
          <p>{post.excerpt}</p>
          <div className={styles.cardBottom}>
            <span>
              {post.author.name}
              <i />约 {post.readingMinutes} 分钟
            </span>
            <span className={styles.cardArrow}>
              <ArrowUpRight size={21} />
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
