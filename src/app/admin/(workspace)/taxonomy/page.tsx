import { getTaxonomy } from "@/lib/cms/taxonomy";
import { requireRole } from "@/lib/auth/session";
import { TaxonomyManager } from "@/components/admin/Management";
export default async function TaxonomyPage() {
  await requireRole(["admin", "editor"]);
  return <TaxonomyManager initial={await getTaxonomy()} />;
}
