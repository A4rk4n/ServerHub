import { GAMES, getGame, type GameDef } from "@/lib/games";

export type CatalogVersion = { id: string; channel: "stable" | "preview" | "legacy"; releasedAt?: string };
export type CatalogGame = {
  id: string; name: string; short: string; tagline: string; installer: GameDef["installer"];
  installerLabel: string; installSizeMb: number; automatic: boolean; sourceName: string; sourceUrl: string;
  authentication: "none" | "oauth" | "user-files";
};

const SOURCES: Record<GameDef["installer"], Pick<CatalogGame,"sourceName"|"sourceUrl"|"authentication">> = {
  mojang: { sourceName: "Mojang", sourceUrl: "https://www.minecraft.net/download/server", authentication: "none" },
  fabric: { sourceName: "Fabric Meta + Mojang", sourceUrl: "https://fabricmc.net/use/server/", authentication: "none" },
  bedrock: { sourceName: "Minecraft Bedrock", sourceUrl: "https://www.minecraft.net/download/server/bedrock", authentication: "none" },
  steamcmd: { sourceName: "Valve SteamCMD", sourceUrl: "https://developer.valvesoftware.com/wiki/SteamCMD", authentication: "none" },
  hytale: { sourceName: "Official Hytale Downloader", sourceUrl: "https://hytale.com/", authentication: "oauth" },
  manual: { sourceName: "Files already on this computer", sourceUrl: "", authentication: "user-files" },
};

export function serverCatalog(): CatalogGame[] {
  return GAMES.map((game) => ({ id: game.id, name: game.name, short: game.short, tagline: game.tagline,
    installer: game.installer, installerLabel: game.installerLabel, installSizeMb: game.installSizeMb,
    automatic: game.installer !== "manual", ...SOURCES[game.installer] }));
}

export function parseMojangVersions(input: unknown): CatalogVersion[] {
  const rows = (input as { versions?: { id?: unknown; type?: unknown; releaseTime?: unknown }[] })?.versions;
  if (!Array.isArray(rows)) throw new Error("Mojang returned an invalid version manifest");
  return rows.filter((row) => typeof row.id === "string" && ["release","snapshot"].includes(String(row.type)))
    .slice(0, 100).map((row) => ({ id: String(row.id), channel: row.type === "release" ? "stable" : "preview", releasedAt: typeof row.releaseTime === "string" ? row.releaseTime : undefined }));
}

async function fetchJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, headers: { accept: "application/json", "user-agent": "ServerHub/1.5" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Official provider returned HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

const versionCache = new Map<string, { expires: number; versions: CatalogVersion[] }>();

export async function catalogVersions(gameId: string, signal?: AbortSignal): Promise<CatalogVersion[]> {
  const cached = versionCache.get(gameId);
  if (cached && cached.expires > Date.now()) return cached.versions;
  const game = getGame(gameId);
  const versions = game.installer === "mojang" || game.installer === "fabric"
    ? parseMojangVersions(await fetchJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", signal))
    : game.versions.map((id): CatalogVersion => ({ id, channel: id === "latest" ? "stable" : "legacy" }));
  versionCache.set(gameId, { expires: Date.now() + 15 * 60_000, versions });
  return versions;
}

export function validCatalogVersion(gameId: string, version: string) {
  const game = getGame(gameId);
  if (game.versions.includes(version)) return true;
  return (game.installer === "mojang" || game.installer === "fabric") && /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version);
}
