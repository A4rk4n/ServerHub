import { AccessLogPanel } from "@/components/access-log-panel";
import { BackupMirrorPanel } from "@/components/backup-mirror-panel";
import { NotificationsPanel } from "@/components/notifications-panel";
import { DiskAlertsPanel } from "@/components/disk-alerts-panel";
import { BackupVerificationPanel } from "@/components/backup-verification-panel";
import { LogRetentionPanel } from "@/components/log-retention-panel";
import { PanelSettingsPanel } from "@/components/panel-settings-panel";
import { PinLockPanel } from "@/components/pin-lock-panel";
import { StatusPagePanel } from "@/components/status-page-panel";
import { ToolHealthManager } from "@/components/tool-health-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tool Health — Server Hub" };
export default function ToolsPage() {
  return (
    <div className="space-y-5">
      <ToolHealthManager />
      <NotificationsPanel />
      <DiskAlertsPanel />
      <BackupVerificationPanel />
      <LogRetentionPanel />
      <PanelSettingsPanel />
      <BackupMirrorPanel />
      <StatusPagePanel />
      <PinLockPanel />
      <AccessLogPanel />
    </div>
  );
}
