import { CommunityLayout } from "@/components/site/CommunityLayout";
import { EmailConfirmation } from "@/components/site/CommunityForms";
import styles from "@/components/site/Community.module.css";
export const metadata = {
  title: "取消订阅",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <CommunityLayout
      title="管理你的邮件订阅"
      intro="你可以在这里停止接收社团的文章推送。"
      eyebrow="DARWIN / LETTERS"
    >
      <div className={styles.confirmation}>
        <EmailConfirmation
          kind="unsubscribe"
          token={typeof token === "string" ? token : ""}
        />
      </div>
    </CommunityLayout>
  );
}
