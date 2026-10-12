// CurseForge integration core. Unlike Modrinth, CurseForge's official
// API requires a personal key (free, from console.curseforge.com) sent
// as an x-api-key header, files are verified with SHA-1 (the strongest
// hash the API provides), and authors may disable third-party downloads
// entirely — in which case a file's downloadUrl is null and the panel
// must say so instead of failing cryptically. Pure helpers only; the
// routes and the sweep own fetch, the filesystem, and the key sidecar.

export const CURSEFORGE_API = "https://api.curseforge.com/v1";
export const CF_GAME_MINECRAFT = 432;
export const CF_CLASS_MODS = 6;
export const CF_LOADER_FABRIC = 4;
const CF_SORT_DOWNLOADS = 6;
const CF_HASH_SHA1 = 1;

export function cfSearchUrl(base: string, query: string, gameVersion: string): string {
  const params = new URLSearchParams({
    gameId: String(CF_GAME_MINECRAFT),
    classId: String(CF_CLASS_MODS),
    modLoaderType: String(CF_LOADER_FABRIC),
    gameVersion,
    searchFilter: query,
    sortField: String(CF_SORT_DOWNLOADS),
    sortOrder: "desc",
    pageSize: "30",
  });
  return `${base}/mods/search?${params.toString()}`;
}

export function cfModUrl(base: string, modId: string): string {
  return `${base}/mods/${encodeURIComponent(modId)}`;
}

export function cfFilesUrl(base: string, modId: string, gameVersion: string): string {
  const params = new URLSearchParams({ gameVersion, modLoaderType: String(CF_LOADER_FABRIC), pageSize: "20" });
  return `${base}/mods/${encodeURIComponent(modId)}/files?${params.toString()}`;
}

export type CurseforgeFileLike = {
  id: number;
  fileName: string;
  downloadUrl?: string | null;
  hashes?: { value: string; algo: number }[];
};

/** SHA-1 is the strongest digest CurseForge publishes (algo 1). */
export function cfSha1(file: CurseforgeFileLike): string | undefined {
  return file.hashes?.find((hash) => hash.algo === CF_HASH_SHA1)?.value;
}

/** CurseForge file names ARE the version identity ("lithium-fabric-
 *  mc1.21.1-0.14.3.jar"); the extension is the only non-version part. */
export function versionFromFileName(fileName: string): string {
  return fileName.replace(/\.(jar|zip)$/i, "");
}

/**
 * File ids are monotonic, so the numerically largest id is the newest
 * build — regardless of response ordering. The newest file is the
 * latest even when its downloadUrl is null (the version comparison is
 * still meaningful; only installing needs the URL).
 */
export function pickLatestCurseforgeFile(
  files: CurseforgeFileLike[]
): { fileId: number; versionNumber: string; url: string | null; filename: string; sha1?: string } | null {
  let newest: CurseforgeFileLike | null = null;
  for (const file of files) {
    if (!file || typeof file.id !== "number" || typeof file.fileName !== "string") continue;
    if (!newest || file.id > newest.id) newest = file;
  }
  if (!newest) return null;
  return {
    fileId: newest.id,
    versionNumber: versionFromFileName(newest.fileName),
    url: newest.downloadUrl ?? null,
    filename: newest.fileName,
    sha1: cfSha1(newest),
  };
}

/** Both "CurseForge" and any future variants ("CurseForge dependency"). */
export function isCurseforgeAddon(source: string): boolean {
  return source.startsWith("CurseForge");
}

export function normalizeCurseforgeKey(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 256);
}

/** Never echo the key back to the browser — last four characters only. */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return `••••••••${key.slice(-4)}`;
}
