import { notFound } from "next/navigation";
import { getAdminDocument } from "@/lib/cms/documents";
import { getTaxonomy } from "@/lib/cms/taxonomy";
import { requireUser } from "@/lib/auth/session";
import { DocumentEditor } from "@/components/admin/DocumentEditor";
export default async function EditPost({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [doc, taxonomy, user] = await Promise.all([
    id === "new" ? null : getAdminDocument(id),
    getTaxonomy(),
    requireUser(),
  ]);
  if (id !== "new" && (!doc || doc.kind !== "post")) notFound();
  return (
    <DocumentEditor
      initial={doc}
      kind="post"
      taxonomy={taxonomy}
      role={user.role}
    />
  );
}
