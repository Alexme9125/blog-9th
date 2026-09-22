import Link from "next/link";
import { Plus, Search, ArrowUpRight } from "lucide-react";
import type { AdminDocument, DocumentKind } from "@/lib/cms/types";
import { dateLabel } from "@/components/site/PostCard";
import styles from "./Admin.module.css";
const labels = {
  draft: "草稿",
  review: "待审核",
  published: "已发布",
  archived: "回收站",
};
export function DocumentList({
  documents,
  kind,
  status = "",
  q = "",
}: {
  documents: AdminDocument[];
  kind: DocumentKind;
  status?: string;
  q?: string;
}) {
  const url = "/admin/" + (kind === "post" ? "posts" : "pages");
  return (
    <>
      <header className={styles.pageHeading}>
        <div>
          <span className="eyebrow">
            {kind === "post" ? "WRITING & PUBLISHING" : "PAGES & COLLECTIONS"}
          </span>
          <h1>{kind === "post" ? "文章管理" : "静态页面"}</h1>
          <p>
            {kind === "post"
              ? "从第一个想法，到正式与读者相遇。"
              : "用统一的模块，整理社团的故事与资料。"}
          </p>
        </div>
        <Link className="button" href={url + "/new"}>
          <Plus size={17} />
          新建{kind === "post" ? "文章" : "页面"}
        </Link>
      </header>
      <div className={styles.listFilters}>
        <nav>
          {[
            ["", "全部"],
            ["draft", "草稿"],
            ["review", "待审核"],
            ["published", "已发布"],
            ["trash", "回收站"],
          ].map(([value, label]) => (
            <Link
              key={value}
              className={status === value ? styles.tabActive : ""}
              href={url + (value ? "?status=" + value : "")}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form action={url}>
          <input type="hidden" name="status" value={status} />
          <input
            aria-label="搜索管理内容"
            name="q"
            placeholder="搜索标题…"
            defaultValue={q}
          />
          <button aria-label="搜索">
            <Search size={16} />
          </button>
        </form>
      </div>
      <section className={styles.panel}>
        {documents.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th>作者</th>
                  <th>最近修改</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={url + "/" + d.id}>
                        {d.draft.title || "未命名草稿"}
                        <small>
                          /{d.draft.slug || "尚未设置地址"}
                          {d.published && d.status !== "published"
                            ? " · 有未发布修改"
                            : ""}
                        </small>
                      </Link>
                    </td>
                    <td>
                      <span className={styles.status}>
                        {d.deletedAt ? "回收站" : labels[d.status]}
                      </span>
                    </td>
                    <td>{d.authorName}</td>
                    <td>{dateLabel(d.updatedAt)}</td>
                    <td>
                      <Link
                        href={url + "/" + d.id}
                        aria-label={"编辑" + d.draft.title}
                      >
                        <ArrowUpRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>这里还没有记录。</h3>
            <p>新建内容，或试试其他筛选条件。</p>
          </div>
        )}
      </section>
    </>
  );
}
