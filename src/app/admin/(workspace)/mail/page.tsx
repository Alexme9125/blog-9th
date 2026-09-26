import { getAdminMailSettings, listMailJobs } from "@/lib/mail/actions";
import { MailManager } from "@/components/admin/MailManager";
export default async function MailPage() {
  const [settings, jobs] = await Promise.all([
    getAdminMailSettings(),
    listMailJobs(50),
  ]);
  return <MailManager initial={settings} jobs={jobs} />;
}
