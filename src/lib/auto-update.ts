// Decision logic for the scheduled "update" task: unlike "maintenance"
// (which always reinstalls), an update task first checks whether there is
// anything new and leaves the server completely untouched when there is
// not — no stop, no safety backup, no restart churn.

import type { GameUpdateState } from "./game-updates";

export type AutoUpdateInput = {
  installer: string;
  currentVersion: string;
  // Latest stable version from the official catalog (mojang/fabric), when known.
  latestStableVersion: string | null;
  // Build comparison for SteamCMD titles (installed manifest vs published build).
  buildStatus: GameUpdateState;
};

export type AutoUpdateDecision = { run: boolean; reason: string };

export function autoUpdateDecision(input: AutoUpdateInput): AutoUpdateDecision {
  if (input.installer === "manual") {
    return { run: false, reason: "Custom servers use user-supplied files and cannot be updated automatically" };
  }
  if (input.installer === "mojang" || input.installer === "fabric") {
    if (!input.latestStableVersion) {
      return { run: false, reason: "Could not determine the latest stable version; skipping to avoid churn" };
    }
    if (input.latestStableVersion === input.currentVersion) {
      return { run: false, reason: `Already on the latest stable version (${input.currentVersion})` };
    }
    return { run: true, reason: `Update available: ${input.currentVersion} → ${input.latestStableVersion}` };
  }
  if (input.installer === "steamcmd") {
    if (input.buildStatus === "update-available") return { run: true, reason: "A newer SteamCMD build is published" };
    if (input.buildStatus === "up-to-date") return { run: false, reason: "The installed build is already current" };
    return { run: false, reason: "Could not confirm a newer build; skipping to avoid churn" };
  }
  // Rolling-release providers without a comparison signal (Bedrock, Hytale):
  // the provider only ships "latest", so a scheduled update re-fetches it.
  return { run: true, reason: "Rolling-release provider; reinstalling the current official build" };
}

// The target version an update task should install for catalog-pinned
// games; rolling providers keep their current (rolling) version string.
export function autoUpdateTargetVersion(input: Pick<AutoUpdateInput, "installer" | "currentVersion" | "latestStableVersion">): string {
  if ((input.installer === "mojang" || input.installer === "fabric") && input.latestStableVersion) return input.latestStableVersion;
  return input.currentVersion;
}
