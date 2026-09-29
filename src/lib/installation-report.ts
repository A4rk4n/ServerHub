import { sanitizeSupportText } from "./support-redaction";

type ReportJob = { id: number; status: string; phase: string; progress: number; attempt: number; error: string; message: string; createdAt?: Date | string | null; updatedAt?: Date | string | null };
type ReportEvent = { level: string; phase: string; progress: number; message: string };

export function createInstallationReport(job: ReportJob, events: ReportEvent[], privateRoots: string[] = []) {
  const clean = (value: unknown, limit = 600) => sanitizeSupportText(String(value ?? ""), privateRoots).replace(/[\r\n\0]+/g, " ").trim().slice(0, limit);
  const lines = [
    "SERVER HUB INSTALLATION DIAGNOSTIC",
    `Generated: ${new Date().toISOString()}`,
    `Job: ${job.id}`,
    `Attempt: ${job.attempt}`,
    `Status: ${clean(job.status, 40)}`,
    `Phase: ${clean(job.phase, 80)}`,
    `Progress: ${Math.max(0, Math.min(100, Number(job.progress) || 0))}%`,
    `Message: ${clean(job.message) || "none"}`,
    `Error: ${clean(job.error) || "none"}`,
    "Recent events:",
    ...events.slice(-12).map((event) => `- [${clean(event.level, 20)}] ${clean(event.phase, 40)} ${Math.max(0, Math.min(100, Number(event.progress) || 0))}% — ${clean(event.message)}`),
  ];
  return `${lines.join("\n")}\n`;
}
