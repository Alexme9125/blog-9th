import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { AdminShell } from "@/components/admin/AdminShell";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "创作后台",
  robots: { index: false, follow: false },
};
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/admin/password");
  return <AdminShell user={user}>{children}</AdminShell>;
}
