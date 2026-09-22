import { Search } from "lucide-react";
import { getPublicPosts } from "@/lib/content/public";
import { Listing } from "@/components/site/Listing";
import styles from "@/components/site/Site.module.css";
export const metadata = { title: "社团刊物与搜索" };
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page } = await searchParams;
  const result = await getPublicPosts({ q, page: Number(page) || 1 });
  return (
    <main id="main" className={"container " + styles.pageContent}>
      <header className={styles.pageHeader}>
        <span className="eyebrow">EXPLORE THE JOURNAL</span>
        <h1>寻找一条新的线索。</h1>
        <p>从一个词开始，连接我们的观察与思考。</p>
        <form action="/search" className={styles.searchForm}>
          <input
            name="q"
            defaultValue={q}
            placeholder="搜索文章、话题或关键词…"
            aria-label="搜索关键词"
            maxLength={100}
          />
          <button className="button" type="submit">
            <Search size={17} />
            搜索
          </button>
        </form>
      </header>
      <p className={styles.searchCount}>
        {q ? "“" + q + "” 的搜索结果" : "全部文章"} · {result.total} 篇记录
      </p>
      <Listing result={result} baseUrl={"/search?q=" + encodeURIComponent(q)} />
    </main>
  );
}
