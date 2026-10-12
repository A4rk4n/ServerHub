// Shared "what is the latest compatible build?" fetchers for the two mod
// providers, used by the per-server update check route AND the scheduled
// fleet sweep so the two can never drift apart. Base URLs are passed in
// (production defaults vs. the SERVERHUB_*_BASE test hooks resolved by
// the caller). Server-side only.

import { modrinthVersionsUrl, pickLatestVersion, type ModrinthVersionLike } from "./addon-updates";
import { cfFilesUrl, pickLatestCurseforgeFile, type CurseforgeFileLike } from "./curseforge";

const UA = { "User-Agent": "ServerHub/1.0 (local desktop server manager)" };

export type LatestAddonBuild = {
  versionNumber: string;
  /** null for CurseForge files whose author disabled third-party downloads. */
  url: string | null;
  filename: string;
  sha512?: string;
  sha1?: string;
};

export function modrinthBase(): string {
  return process.env.SERVERHUB_MODRINTH_BASE ?? "https://api.modrinth.com/v2";
}

export function curseforgeBase(): string {
  return process.env.SERVERHUB_CURSEFORGE_BASE ?? "https://api.curseforge.com/v1";
}

/** Throws on HTTP/network failure; null when no compatible build exists. */
export async function modrinthLatest(projectId: string, gameVersion: string): Promise<LatestAddonBuild | null> {
  const response = await fetch(modrinthVersionsUrl(modrinthBase(), projectId, gameVersion), { headers: UA, cache: "no-store" });
  if (!response.ok) throw new Error(`Modrinth returned HTTP ${response.status}`);
  const latest = pickLatestVersion((await response.json()) as ModrinthVersionLike[]);
  if (!latest) return null;
  return { versionNumber: latest.versionNumber, url: latest.url, filename: latest.filename, sha512: latest.sha512 };
}

/** Throws on HTTP/network failure (including a missing/rejected key);
 *  null when no compatible build exists. */
export async function curseforgeLatest(apiKey: string, modId: string, gameVersion: string): Promise<LatestAddonBuild | null> {
  if (!apiKey) throw new Error("A CurseForge API key is required");
  const response = await fetch(cfFilesUrl(curseforgeBase(), modId, gameVersion), {
    headers: { ...UA, "x-api-key": apiKey },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`CurseForge returned HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: CurseforgeFileLike[] };
  const latest = pickLatestCurseforgeFile(payload.data ?? []);
  if (!latest) return null;
  return { versionNumber: latest.versionNumber, url: latest.url, filename: latest.filename, sha1: latest.sha1 };
}
