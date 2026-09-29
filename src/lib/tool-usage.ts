import { db } from "@/db";
import { toolInventory, toolOperations } from "@/db/schema";

export const TRACKED_TOOL_IDS = ["steamcmd", "java", "powershell", "webview2", "hytale-downloader"] as const;
export type TrackedToolId = typeof TRACKED_TOOL_IDS[number];

export function isTrackedToolId(value: string): value is TrackedToolId {
  return (TRACKED_TOOL_IDS as readonly string[]).includes(value);
}

const definitions: Record<TrackedToolId, { name: string; ownership: string; pathCategory: string; expectedVersion: string }> = {
  steamcmd: { name: "SteamCMD", ownership: "managed", pathCategory: "managed-tools", expectedVersion: "vendor-current" },
  java: { name: "Java", ownership: "system", pathCategory: "system-path", expectedVersion: "provider-compatible" },
  powershell: { name: "PowerShell", ownership: "system", pathCategory: "windows-system", expectedVersion: "5.1+" },
  webview2: { name: "WebView2 Runtime", ownership: "system", pathCategory: "windows-runtime", expectedVersion: "supported-runtime" },
  "hytale-downloader": { name: "Hytale downloader", ownership: "managed", pathCategory: "managed-tools", expectedVersion: "vendor-current" },
};

export async function recordSuccessfulToolUse(toolId: TrackedToolId, summary: string) {
  const now = new Date();
  const safeSummary = summary.replace(/[\r\n\0]/g, " ").slice(0, 240);
  await db.insert(toolInventory).values({ id: toolId, ...definitions[toolId], available: true, lastUsedAt: now, updatedAt: now }).onConflictDoUpdate({ target: toolInventory.id, set: { lastUsedAt: now, updatedAt: now } });
  await db.insert(toolOperations).values({ toolId, operation: "use", status: "succeeded", summary: safeSummary, completedAt: now });
}
