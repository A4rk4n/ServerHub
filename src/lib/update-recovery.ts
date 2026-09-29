export type RecoveredUpdateState = { status: string; message: string } | null;
export function recoverInterruptedUpdateState(status: string, installationJobActive: boolean): RecoveredUpdateState {
  if (status === "validating-runtime") return { status: "awaiting-readiness", message: "Runtime validation was interrupted; start the server to validate the updated version again." };
  if (status === "rollback-validating") return { status: "rollback-restored", message: "Restored-version validation was interrupted; start the server to validate it again." };
  if (status === "rollback-running") return { status: "rollback-failed", message: "Server Hub restarted during rollback. Inspect the managed files and safety backup before retrying." };
  if (status === "installing" && !installationJobActive) return { status: "installation-failed", message: "Update installation state was interrupted without a recoverable installation job." };
  return null;
}
