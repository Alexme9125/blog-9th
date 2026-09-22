import { getAdminDocuments } from "@/lib/cms/documents";
import { requireRole } from "@/lib/auth/session";
import { DocumentList } from "@/components/admin/DocumentList";
export default async function Pages({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requireRole(["admin", "editor"]);
  const { status, q } = await searchParams;
  const documents = await getAdminDocuments({ kind: "page", status, q });
  return (
    <DocumentList documents={documents} kind="page" status={status} q={q} />
  );
}
