import { getMembers, getSiteSettings } from "@/lib/content/public";
import { MemberList } from "@/components/site/MemberList";
import styles from "@/components/site/Site.module.css";
export const metadata = { title: "主要成员" };
export default async function MembersPage() {
  const [members, settings] = await Promise.all([
    getMembers(),
    getSiteSettings(),
  ]);
  return (
    <main id="main" className={"container " + styles.pageContent}>
      <header className={styles.pageHeader}>
        <span className="eyebrow">THE PEOPLE / DARWIN</span>
        <h1>不同的好奇心，相同的热爱。</h1>
        <p>{settings.membersIntro}</p>
      </header>
      {members.length ? (
        <MemberList members={members} />
      ) : (
        <div className="empty-state">
          <h3>期待在这里认识彼此。</h3>
          <p>成员介绍正在整理中。</p>
        </div>
      )}
      {members.some((m) => m.role.includes("示例")) && (
        <p className={styles.demoNotice}>
          当前成员资料为开发示例，非真实社团成员。
        </p>
      )}
    </main>
  );
}
