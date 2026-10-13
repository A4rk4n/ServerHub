// Fabric meta API resolution, defensively typed. The two lists come from
// different endpoints with different shapes:
//   /v2/versions/loader/:game  -> [{ loader: {version, stable}, intermediary: {...} }]
//   /v2/versions/installer     -> [{ url, maven, version, stable }]
// Notably the per-game loader list has NO installer field — assuming one
// crashed installations with "Cannot read properties of undefined
// (reading 'stable')". Newest versions appear first in both lists.

export function fabricLoaderListUrl(gameVersion: string): string {
  return `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`;
}

export const FABRIC_INSTALLER_LIST_URL = "https://meta.fabricmc.net/v2/versions/installer";

export function fabricServerJarUrl(gameVersion: string, loaderVersion: string, installerVersion: string): string {
  return `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/${encodeURIComponent(installerVersion)}/server/jar`;
}

type VersionLike = { version?: unknown; stable?: unknown };

function pickVersion(entries: VersionLike[]): string | null {
  const usable = entries.filter((entry) => typeof entry?.version === "string" && (entry.version as string).length > 0);
  const stable = usable.find((entry) => entry.stable === true);
  return ((stable ?? usable[0])?.version as string) ?? null;
}

// Newest-first list of { loader: {version, stable}, ... }: prefer the
// newest stable loader, fall back to the newest of any kind.
export function pickFabricLoader(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;
  return pickVersion(payload.map((entry) => (entry as { loader?: VersionLike })?.loader ?? {}));
}

// Newest-first list of { version, stable }: same preference.
export function pickFabricInstaller(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;
  return pickVersion(payload as VersionLike[]);
}
