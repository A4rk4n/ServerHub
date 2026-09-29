export type ReadinessProbe = "minecraft-status" | "steam-a2s" | "process-stability" | "tcp-connect";
export function readinessProbeFor(gameId: string, protocol: "TCP" | "UDP"): ReadinessProbe {
  if (gameId.startsWith("minecraft") && gameId !== "minecraft-bedrock") return "minecraft-status";
  if (["ark","rust","valheim"].includes(gameId)) return "steam-a2s";
  return protocol === "UDP" ? "process-stability" : "tcp-connect";
}
export function minimumProcessStabilityMs(gameId: string) { return gameId === "dragonwilds" ? 15_000 : 10_000; }
export function processStabilityReady(startedAtMs: number, now = Date.now(), minimumMs = 10_000) { return Number.isFinite(startedAtMs) && now - startedAtMs >= minimumMs; }
export function readinessWaitingReason(gameId: string, probe: ReadinessProbe) {
  if (probe === "process-stability") return `Waiting for ${gameId === "dragonwilds" ? "Dragonwilds" : "provider"} process stability (${minimumProcessStabilityMs(gameId) / 1000} seconds)`;
  if (probe === "steam-a2s") return "Waiting for the provider's Steam A2S query response";
  if (probe === "minecraft-status") return "Waiting for the Minecraft status protocol";
  return "Waiting for the provider TCP port to accept connections";
}
export function readinessRemediation(gameId: string, probe: ReadinessProbe) {
  if (gameId === "dragonwilds") return "Verify Owner ID, DedicatedServer.ini, UDP port binding, Windows Firewall, and the Dragonwilds console log.";
  if (probe === "steam-a2s") return "Verify the query port, bind address, Windows Firewall, and provider console output.";
  if (probe === "minecraft-status") return "Verify server.properties, Java health, bind address, and the Minecraft console log.";
  return "Review the bind address, required ports, Windows Firewall, and provider console output.";
}
