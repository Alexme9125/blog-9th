import { getAdminDocuments } from "@/lib/cms/documents";
import { DocumentList } from "@/components/admin/DocumentList";
export default async function Posts({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;
  const documents = await getAdminDocuments({ kind: "post", status, q });
  return (
    <DocumentList documents={documents} kind="post" status={status} q={q} />
  );
}
