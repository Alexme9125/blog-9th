import { getUsers } from "@/lib/cms/users";
import { requireRole } from "@/lib/auth/session";
import { UsersManager } from "@/components/admin/Management";
export default async function UsersPage() {
  const user = await requireRole(["admin"]);
  return <UsersManager initial={await getUsers()} currentUserId={user.id} />;
}
