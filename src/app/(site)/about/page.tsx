import { SpecialPage } from "@/components/site/SpecialPage";
export const metadata = {
  title: "关于社团",
  description: "Darwin 动漫社：用科学与人文创造幻想中的未来。",
  alternates: { canonical: "/about" },
};
export default function AboutPage() {
  return <SpecialPage pageKey="about" />;
}
