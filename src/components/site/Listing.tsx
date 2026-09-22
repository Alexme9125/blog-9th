import Link from "next/link";
import { PostCard } from "./PostCard";
import type { PostResult } from "@/lib/content/types";
import styles from "./Site.module.css";
export function Listing({
  result,
  baseUrl,
}: {
  result: PostResult;
  baseUrl: string;
}) {
  return (
    <>
      {result.posts.length ? (
        <div className={styles.postGrid}>
          {result.posts.map((p, i) => (
            <PostCard key={p.id} post={p} index={i} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>还没有找到这条线索。</h3>
          <p>试试其他关键词，或回到首页继续探索。</p>
          <Link className="text-link" href="/">
            返回首页 ↗
          </Link>
        </div>
      )}
      {result.pages > 1 && (
        <nav className="pagination" aria-label="分页">
          {Array.from({ length: result.pages }, (_, i) => (
            <Link
              key={i}
              aria-current={result.page === i + 1 ? "page" : undefined}
              href={
                baseUrl +
                (baseUrl.includes("?") ? "&" : "?") +
                "page=" +
                (i + 1)
              }
            >
              {i + 1}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
