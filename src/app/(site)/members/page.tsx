import { getMembers, getSiteSettings } from "@/lib/content/public";
import { MemberList } from "@/components/site/MemberList";
import { MarginGeometry } from "@/components/site/MarginGeometry";
import { MembersHallArt } from "@/components/site/MembersHallArt";
import hall from "@/components/site/MembersHall.module.css";
import styles from "@/components/site/Site.module.css";
export const metadata = { title: "主要成员" };
export default async function MembersPage() {
  const [members, settings] = await Promise.all([
    getMembers(),
    getSiteSettings(),
  ]);
  return (
    <main id="main" className={hall.page}>
      <MarginGeometry variant="journal" />
      <div className={"container " + styles.pageContent}>
        <header className={`${styles.pageHeader} ${hall.header}`}>
          <div className={hall.headerText}>
            <span className="eyebrow">DARWIN / HALL OF FAME</span>
            <h1>不同的好奇心，相同的热爱。</h1>
            <p>{settings.membersIntro}</p>
          </div>
          <MembersHallArt />
        </header>
        {members.length ? (
          <MemberList members={members} variant="hall" />
        ) : (
          <div className={`empty-state ${hall.empty}`}>
            <h3>期待在这里认识彼此。</h3>
            <p>成员介绍正在整理中。</p>
          </div>
        )}
        {members.some((m) => m.role.includes("示例")) && (
          <p className={styles.demoNotice}>
            当前成员资料为开发示例，非真实社团成员。
          </p>
        )}
      </div>
    </main>
  );
}
