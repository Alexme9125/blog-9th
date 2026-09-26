import Link from "next/link";
import { ArrowUpRight, FilePenLine, ShieldCheck, Orbit } from "lucide-react";
import { getAdminSpecialPages } from "@/lib/special-pages/actions";
import admin from "@/components/admin/Admin.module.css";
import styles from "@/components/admin/Service.module.css";
export default async function SpecialPages() {
  const pages = await getAdminSpecialPages();
  return (
    <>
      <header className={admin.pageHeading}>
        <div>
          <span className="eyebrow">DARWIN / COMMUNITY PAGES</span>
          <h1>特殊页面</h1>
          <p>在固定入口介绍社团，也清楚说明如何使用和保护来访者的资料。</p>
        </div>
      </header>
      <div className={styles.cards}>
        {pages.map((page) => (
          <section className={styles.card} key={page.key}>
            {page.key === "privacy" ? (
              <ShieldCheck size={28} strokeWidth={1} />
            ) : (
              <Orbit size={28} strokeWidth={1} />
            )}
            <div className={styles.meta}>
              /{page.key} · {page.published ? "已发布" : "默认内容"}
            </div>
            <h2>{page.title}</h2>
            <p>
              {page.key === "privacy"
                ? "说明邮件订阅、入社申请及站点访问涉及的信息处理方式。"
                : "介绍共同的兴趣、社团理念，以及你希望新成员了解的事情。"}
            </p>
            <div className={styles.actions}>
              <Link
                className="button"
                href={"/admin/special-pages/" + page.key}
              >
                <FilePenLine size={15} />
                编辑页面
              </Link>
              <Link
                className="button secondary"
                href={"/" + page.key}
                target="_blank"
              >
                查看公开页
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
