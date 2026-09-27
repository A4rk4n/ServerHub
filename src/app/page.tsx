import { getOverview } from "@/lib/overview-data";
import { DashboardView } from "@/components/dashboard-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getOverview();
  return <DashboardView initial={data} />;
}
