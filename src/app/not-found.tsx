import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { MissingPage } from "@/components/site/MissingPage";
import { defaultSiteSettings } from "@/lib/cms/defaults";
export default function NotFound() {
  return (
    <div id="top">
      <Header settings={defaultSiteSettings} />
      <MissingPage />
      <Footer settings={defaultSiteSettings} />
    </div>
  );
}
