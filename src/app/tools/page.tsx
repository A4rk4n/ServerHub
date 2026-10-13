import { AccessLogPanel } from "@/components/access-log-panel";
import { AddonUpdateSweepPanel } from "@/components/addon-update-sweep-panel";
import { SelfCheckPanel } from "@/components/self-check-panel";
import { BackupMirrorPanel } from "@/components/backup-mirror-panel";
import { CollapseSection } from "@/components/collapse-section";
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
    <div className="space-y-4">
      <ToolHealthManager />
      <SelfCheckPanel />
      <CollapseSection title="Notifications & alerts" subtitle="Webhooks, daily digest, disk space warnings">
        <NotificationsPanel />
        <DiskAlertsPanel />
      </CollapseSection>
      <CollapseSection title="Backups" subtitle="Integrity verification, mirror destination">
        <BackupVerificationPanel />
        <BackupMirrorPanel />
      </CollapseSection>
      <CollapseSection title="Housekeeping" subtitle="Console log retention, mod update sweep">
        <LogRetentionPanel />
        <AddonUpdateSweepPanel />
      </CollapseSection>
      <CollapseSection title="Panel & security" subtitle="Panel settings, status page, PIN lock, access log">
        <PanelSettingsPanel />
        <StatusPagePanel />
        <PinLockPanel />
        <AccessLogPanel />
      </CollapseSection>
    </div>
  );
}
