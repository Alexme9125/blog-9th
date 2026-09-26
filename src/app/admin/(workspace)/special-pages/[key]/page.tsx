import { notFound } from "next/navigation";
import { getAdminSpecialPage } from "@/lib/special-pages/actions";
import { SpecialPageEditor } from "@/components/admin/SpecialPageEditor";
export default async function EditSpecialPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  if (key !== "privacy" && key !== "about") notFound();
  const page = await getAdminSpecialPage(key);
  if (!page) notFound();
  return <SpecialPageEditor initial={page} />;
}
