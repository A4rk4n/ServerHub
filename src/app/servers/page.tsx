import { getOverview } from "@/lib/overview-data";
import { ServersView } from "@/components/servers-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Servers — Server Hub" };

export default async function ServersPage() {
  const data = await getOverview();
  return <ServersView initial={data.servers} />;
}
