import type { MetadataRoute } from "next";
import { getEffectivePublicUrl } from "@/lib/site-access/store";
export const dynamic = "force-dynamic";
export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/subscribe/confirm", "/subscribe/unsubscribe", "/join/confirm"] },
    sitemap: `${await getEffectivePublicUrl()}/sitemap.xml`,
  };
}
