import Link from "next/link";
import {
  ArrowUpRight,
  Plus,
  FileText,
  Clock,
  CheckCheck,
  Send,
} from "lucide-react";
import { getDashboard } from "@/lib/cms/documents";
import { requireUser } from "@/lib/auth/session";
import { dateLabel } from "@/components/site/PostCard";
import { MarginGeometry } from "@/components/site/MarginGeometry";
import styles from "@/components/admin/Admin.module.css";
const labels = {
  draft: "草稿",
  review: "待审核",
  published: "已发布",
  archived: "已撤回",
};
export default async function Dashboard() {
  const [user, data] = await Promise.all([requireUser(), getDashboard()]);
  return (
    <div className={styles.dashboard}>
      <MarginGeometry variant="studio" />
      <header className={styles.pageHeading}>
        <div>
          <span className="eyebrow">YOUR CREATIVE SPACE</span>
          <h1>你好，{user.name}。</h1>
          <p>今天，有什么值得被记录？</p>
        </div>
        <Link className="button" href="/admin/posts/new">
          <Plus size={17} />
          写一篇文章
        </Link>
      </header>
      <div className={styles.stats}>
        {[
          { label: "全部记录", value: data.total, icon: FileText },
          { label: "写作中的草稿", value: data.drafts, icon: Clock },
          { label: "等待审核", value: data.review, icon: Send },
          { label: "已经发布", value: data.published, icon: CheckCheck },
        ].map((s) => (
          <div key={s.label}>
            <span>
              {s.label}
              <s.icon size={16} />
            </span>
            <strong>{String(s.value).padStart(2, "0")}</strong>
          </div>
        ))}
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <h2>最近的记录</h2>
          <Link href="/admin/posts" className="text-link">
            管理文章
            <ArrowUpRight size={16} />
          </Link>
        </div>
        {data.recent.length ? (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>标题</th>
                  <th>状态</th>
                  <th>最近修改</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.recent.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link
                        href={
                          "/admin/" +
                          (d.kind === "post" ? "posts" : "pages") +
                          "/" +
                          d.id
                        }
                      >
                        {d.draft.title || "未命名草稿"}
                        <small>{d.authorName}</small>
                      </Link>
                    </td>
                    <td>
                      <span className={styles.status}>{labels[d.status]}</span>
                    </td>
                    <td>{dateLabel(d.updatedAt)}</td>
                    <td>
                      <Link
                        href={
                          "/admin/" +
                          (d.kind === "post" ? "posts" : "pages") +
                          "/" +
                          d.id
                        }
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
            <h3>从第一篇记录开始。</h3>
            <p>草稿会保存在这里，准备好后再提交审核。</p>
          </div>
        )}
      </section>
      <div className={styles.studioNote}>
        <span>关于创作</span>
        <p>
          一个问题，一页笔记，一段尚未完成的思考。
          <br />
          好奇心，是所有记录的起点。
        </p>
      </div>
    </div>
  );
}
