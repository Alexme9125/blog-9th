import { CommunityLayout } from "@/components/site/CommunityLayout";
import { EmailConfirmation } from "@/components/site/CommunityForms";
import styles from "@/components/site/Community.module.css";
export const metadata = {
  title: "确认订阅",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <CommunityLayout
      title="确认邮件订阅"
      intro="再确认一步，让好奇心保持联络。"
      eyebrow="DARWIN / LETTERS"
    >
      <div className={styles.confirmation}>
        <EmailConfirmation
          kind="subscribe"
          token={typeof token === "string" ? token : ""}
        />
      </div>
    </CommunityLayout>
  );
}
