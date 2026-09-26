import { CommunityLayout } from "@/components/site/CommunityLayout";
import { EmailConfirmation } from "@/components/site/CommunityForms";
import styles from "@/components/site/Community.module.css";
export const metadata = {
  title: "确认入社申请",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function JoinConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <CommunityLayout
      title="确认你的入社申请"
      intro="确认邮箱后，申请表会送达社团，你也将收到一份副本。"
      eyebrow="DARWIN / JOIN US"
    >
      <div className={styles.confirmation}>
        <EmailConfirmation
          kind="join"
          token={typeof token === "string" ? token : ""}
        />
      </div>
    </CommunityLayout>
  );
}
