import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { getSiteSettings } from "@/lib/content/public";
import { getEffectivePublicUrl } from "@/lib/site-access/store";
import type { Metadata } from "next";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { metadataBase: new URL(await getEffectivePublicUrl()) };
}
export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getSiteSettings();
  return (
    <div id="top">
      <Header settings={settings} />
      {children}
      <Footer settings={settings} />
    </div>
  );
}
