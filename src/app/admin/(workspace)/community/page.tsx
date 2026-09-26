import { requireRole } from "@/lib/auth/server";
import { getAdminCommunity } from "@/lib/community/admin";
import { getMailDeliveryAvailability } from "@/lib/mail/config";
import { getPublicPosts } from "@/lib/content/public";
import { CommunityManager } from "@/components/admin/CommunityManager";
export default async function CommunityPage() {
  const user = await requireRole(["admin", "editor"]);
  const [data, config, published] = await Promise.all([
    getAdminCommunity(),
    getMailDeliveryAvailability(),
    getPublicPosts({ limit: 100 }),
  ]);
  const articles = [...published.posts];
  for (let page = 2; page <= published.pages; page++) {
    articles.push(...(await getPublicPosts({ limit: 100, page })).posts);
  }
  return (
    <CommunityManager
      data={data}
      posts={articles.map((post) => ({
        id: post.id,
        title: post.title,
      }))}
      role={user.role}
      manualEnabled={config.enabled && config.allowManualPush}
    />
  );
}
