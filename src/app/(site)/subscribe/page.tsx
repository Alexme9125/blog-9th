import Link from "next/link";
import { CommunityLayout } from "@/components/site/CommunityLayout";
import { CommunityForm } from "@/components/site/CommunityForms";
import { getPublicMailAvailability } from "@/lib/mail/actions";
import styles from "@/components/site/Community.module.css";
export const metadata = {
  title: "邮件订阅",
  description: "通过邮件接收 Darwin 动漫社的文章摘要与链接。",
};
export default async function SubscribePage() {
  const { available } = await getPublicMailAvailability();
  return (
    <CommunityLayout
      title="让好奇心，保持联络。"
      intro="把社团的新记录送进你的邮箱，与我们继续探索科学、人文与想象。"
      eyebrow="DARWIN / LETTERS"
    >
      <div className={styles.columns}>
        <aside className={styles.aside}>
          <h2>
            一封邮件，
            <br />
            一个继续阅读的起点。
          </h2>
          <p>
            接收文章摘要和原文链接。邮箱确认后订阅生效，随时可以通过邮件中的链接退订。
          </p>
          <p>
            喜欢用阅读器？也可以<Link href="/rss.xml">订阅 RSS</Link>。
          </p>
        </aside>
        <CommunityForm kind="subscribe" available={available} />
      </div>
    </CommunityLayout>
  );
}
