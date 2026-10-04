// Pure logic for game-server update alerts on SteamCMD titles: parse the
// locally installed build id from SteamCMD's app manifest, extract the
// latest public-branch build id from the steamcmd.net app-info mirror,
// and compare the two conservatively.

export type GameUpdateState = "update-available" | "up-to-date" | "unknown";

export function steamAppInfoUrl(appId: number): string {
  return `https://api.steamcmd.net/v1/info/${appId}`;
}

export function appManifestName(appId: number): string {
  return `appmanifest_${appId}.acf`;
}

// SteamCMD writes a small VDF manifest next to the installed depots.
// Only the buildid key matters here, so a targeted match beats a full
// VDF parser.
export function parseAppManifestBuildId(acf: string): string | null {
  const match = /"buildid"\s+"(\d+)"/i.exec(acf);
  return match ? match[1] : null;
}

// Defensive walk of the steamcmd.net payload:
// data[appid].depots.branches.public.buildid — every level may be absent.
export function extractLatestBuildId(payload: unknown, appId: number): { buildId: string; timeUpdated: string | null } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const data = (payload as { data?: Record<string, unknown> }).data;
  const app = data?.[String(appId)] as { depots?: { branches?: { public?: { buildid?: unknown; timeupdated?: unknown } } } } | undefined;
  const branch = app?.depots?.branches?.public;
  if (!branch || typeof branch.buildid !== "string" || !/^\d+$/.test(branch.buildid)) return null;
  return { buildId: branch.buildid, timeUpdated: typeof branch.timeupdated === "string" ? branch.timeupdated : null };
}

// Steam build ids increase monotonically. The mirror occasionally lags a
// release, so an installed build NEWER than the reported latest must
// read as up-to-date — never as a false update alert.
export function compareBuilds(installed: string | null, latest: string | null): GameUpdateState {
  if (!installed || !latest) return "unknown";
  const installedNum = Number(installed);
  const latestNum = Number(latest);
  if (!Number.isSafeInteger(installedNum) || !Number.isSafeInteger(latestNum)) return "unknown";
  return latestNum > installedNum ? "update-available" : "up-to-date";
}

// Latest-build lookups are cached per Steam app (not per server): six
// hours on success, fifteen minutes on failure — shared by the badge
// route and the auto-update scheduler so the community app-info mirror
// stays comfortable no matter how many callers ask.
export const OK_TTL_MS = 6 * 60 * 60 * 1000;
export const FAIL_TTL_MS = 15 * 60 * 1000;
const latestCache = new Map<number, { at: number; latest: { buildId: string; timeUpdated: string | null } | null }>();

export async function fetchLatestGameBuild(appId: number): Promise<{ buildId: string; timeUpdated: string | null } | null> {
  const cached = latestCache.get(appId);
  const now = Date.now();
  if (cached && now - cached.at < (cached.latest ? OK_TTL_MS : FAIL_TTL_MS)) return cached.latest;
  let latest: { buildId: string; timeUpdated: string | null } | null = null;
  try {
    const response = await fetch(steamAppInfoUrl(appId), {
      headers: { Accept: "application/json", "User-Agent": "ServerHub-game-update-check" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (response.ok) latest = extractLatestBuildId(await response.json(), appId);
  } catch {
    /* mirror unreachable: report unknown, retry after FAIL_TTL */
  }
  latestCache.set(appId, { at: now, latest });
  return latest;
}
