import { Suspense } from "react";
import { StatusPageView } from "@/components/status-page-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Server Status" };

export default function PublicStatusPage() {
  return (
    <Suspense fallback={null}>
      <StatusPageView />
    </Suspense>
  );
}
