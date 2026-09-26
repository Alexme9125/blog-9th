import Link from "next/link";
import { CommunityLayout } from "@/components/site/CommunityLayout";
import { CommunityForm } from "@/components/site/CommunityForms";
import { getPublicCommunityAvailability } from "@/lib/community/actions";
import styles from "@/components/site/Community.module.css";
export const metadata = {
  title: "申请入社",
  description: "与 Darwin 动漫社一起，用科学与人文创造幻想中的未来。",
};
export default async function JoinPage() {
  const { applications } = await getPublicCommunityAvailability();
  return (
    <CommunityLayout
      title="因为好奇，我们相遇。"
      intro="用科学与人文创造幻想中的未来。欢迎带着你的兴趣，向我们介绍自己。"
      eyebrow="DARWIN / JOIN US"
    >
      <div className={styles.columns}>
        <aside className={styles.aside}>
          <h2>
            关于你，
            <br />
            关于想一起做的事情。
          </h2>
          <p>
            动漫与游戏、自然科学、社会科学、AI……从任何一个让你着迷的话题开始。
          </p>
          <p>
            填写申请表后，请到邮箱完成确认。我们会保留你的申请，并向你发送一份副本。
          </p>
          <p>
            <Link href="/about">先了解社团</Link>
          </p>
        </aside>
        <CommunityForm kind="join" available={applications} />
      </div>
    </CommunityLayout>
  );
}
