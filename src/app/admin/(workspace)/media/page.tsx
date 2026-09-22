import { getMedia } from "@/lib/cms/media";
import { MediaManager } from "@/components/admin/Management";
export default async function MediaPage() {
  return <MediaManager initial={await getMedia()} />;
}
