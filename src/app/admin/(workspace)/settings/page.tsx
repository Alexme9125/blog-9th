import { getAdminSettings } from "@/lib/cms/settings";
import { SettingsManager } from "@/components/admin/Management";
import { getAdminSiteAccess } from "@/lib/site-access/actions";
export default async function SettingsPage() {
  const [settings, access] = await Promise.all([
    getAdminSettings(),
    getAdminSiteAccess(),
  ]);
  return <SettingsManager initial={settings} access={access} />;
}
