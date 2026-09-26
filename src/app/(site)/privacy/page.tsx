import { SpecialPage } from "@/components/site/SpecialPage";
export const metadata = {
  title: "隐私政策",
  description: "了解本站的邮件订阅、入社申请与信息处理方式。",
  alternates: { canonical: "/privacy" },
};
export default function PrivacyPage() {
  return <SpecialPage pageKey="privacy" />;
}
