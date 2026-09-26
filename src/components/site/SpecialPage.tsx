import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getPublicSpecialPage } from "@/lib/special-pages/store";
import type { SpecialPageKey } from "@/lib/special-pages/types";
import { CommunityLayout } from "./CommunityLayout";
import { RichText } from "./RichText";
import styles from "./Community.module.css";
export async function SpecialPage({ pageKey }: { pageKey: SpecialPageKey }) {
  const page = await getPublicSpecialPage(pageKey);
  return (
    <CommunityLayout
      title={page.title}
      intro={page.intro}
      eyebrow={pageKey === "about" ? "DARWIN / ABOUT US" : "DARWIN / PRIVACY"}
    >
      <article className={styles.reading}>
        {page.publishedAt && (
          <p className={styles.hint}>
            更新于{" "}
            {new Date(page.publishedAt).toLocaleDateString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
          </p>
        )}
        <RichText doc={page.body} />
        <nav className={styles.pageLinks} aria-label="相关页面">
          {pageKey === "about" ? (
            <>
              <Link href="/members">
                认识主要成员
                <ArrowUpRight size={14} />
              </Link>
              <Link href="/join">
                申请加入社团
                <ArrowUpRight size={14} />
              </Link>
              <Link href="/subscribe">
                邮件订阅
                <ArrowUpRight size={14} />
              </Link>
            </>
          ) : (
            <>
              <Link href="/subscribe">
                邮件订阅
                <ArrowUpRight size={14} />
              </Link>
              <Link href="/about">
                关于社团
                <ArrowUpRight size={14} />
              </Link>
            </>
          )}
        </nav>
      </article>
    </CommunityLayout>
  );
}
