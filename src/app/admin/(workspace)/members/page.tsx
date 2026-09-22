import { getAdminMembers } from "@/lib/cms/members";
import { getSiteSettings } from "@/lib/content/public";
import { requireRole } from "@/lib/auth/session";
import { MembersManager } from "@/components/admin/Management";
export default async function MemberAdminPage() {
  await requireRole(["admin", "editor"]);
  const [members, settings] = await Promise.all([
    getAdminMembers(),
    getSiteSettings(),
  ]);
  return <MembersManager initial={members} intro={settings.membersIntro} />;
}
