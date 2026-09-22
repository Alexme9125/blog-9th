import { notFound } from "next/navigation";
import { getAdminDocument } from "@/lib/cms/documents";
import { getTaxonomy } from "@/lib/cms/taxonomy";
import { getAdminMembers } from "@/lib/cms/members";
import { requireRole } from "@/lib/auth/session";
import { DocumentEditor } from "@/components/admin/DocumentEditor";
export default async function EditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole(["admin", "editor"]);
  const { id } = await params;
  const [doc, taxonomy, members] = await Promise.all([
    id === "new" ? null : getAdminDocument(id),
    getTaxonomy(),
    getAdminMembers(),
  ]);
  if (id !== "new" && (!doc || doc.kind !== "page")) notFound();
  return (
    <DocumentEditor
      initial={doc}
      kind="page"
      taxonomy={taxonomy}
      role={user.role}
      members={members}
    />
  );
}
