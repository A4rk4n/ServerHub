import { NotificationsPanel } from "@/components/notifications-panel";
import { PinLockPanel } from "@/components/pin-lock-panel";
import { ToolHealthManager } from "@/components/tool-health-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tool Health — Server Hub" };
export default function ToolsPage() {
  return (
    <div className="space-y-5">
      <ToolHealthManager />
      <NotificationsPanel />
      <PinLockPanel />
    </div>
  );
}
