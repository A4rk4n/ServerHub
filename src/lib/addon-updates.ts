// Addon update checker (F58): find installed Modrinth mods whose
// latest compatible version is newer than what is on disk. Pure
// logic only — version comparison, latest-pick, and the per-addon
// plan; the route does the fetching and downloading.

export type AddonUpdateStatus = "update" | "current" | "unknown";

/**
 * Parse a mod version into comparable numeric segments. Handles the
 * common Modrinth shapes: "1.2.3", "v1.2.3", "1.2.3+1.21.1",
 * "1.2.3-beta.2" (build/pre-release tails are compared as a
 * lower-priority string). Returns null for strings with no leading
 * number — those cannot be ordered, only compared for equality.
 */
export function parseModVersion(raw: string): { nums: number[]; tail: string } | null {
  const cleaned = raw.trim().replace(/^[vV]/, "");
  const match = /^(\d+(?:\.\d+)*)(.*)$/.exec(cleaned);
  if (!match) return null;
  return { nums: match[1].split(".").map(Number), tail: match[2] };
}

/**
 * Status of an installed version against the latest compatible one.
 * When both parse, real ordering decides — a newer installed build
 * (downgrade bait) reads "current", not "update". When either side
 * is unparseable, inequality is the only signal we have.
 */
export function compareAddonVersions(installed: string, latest: string): AddonUpdateStatus {
  if (installed.trim() === latest.trim()) return "current";
  const a = parseModVersion(installed);
  const b = parseModVersion(latest);
  if (!a || !b) return "update"; // different, unorderable — surface it and let the operator decide
  const length = Math.max(a.nums.length, b.nums.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.nums[i] ?? 0;
    const y = b.nums[i] ?? 0;
    if (x !== y) return y > x ? "update" : "current";
  }
  // Same numeric core: "1.2.3" vs "1.2.3+1.21" — a release beats a
  // pre-release tail ("-beta"), otherwise treat differing tails as an
  // update only when the latest tail sorts higher.
  if (a.tail === b.tail) return "current";
  if (a.tail.startsWith("-") && !b.tail.startsWith("-")) return "update";
  if (!a.tail.startsWith("-") && b.tail.startsWith("-")) return "current";
  return b.tail > a.tail ? "update" : "current";
}

/** Version-list URL shared by the manual check route and the scheduled
 *  sweep: Fabric loader, pinned to the server's game version, featured
 *  releases only. */
export function modrinthVersionsUrl(base: string, projectId: string, gameVersion: string): string {
  const loaders = encodeURIComponent(JSON.stringify(["fabric"]));
  const versions = encodeURIComponent(JSON.stringify([gameVersion]));
  return `${base}/project/${encodeURIComponent(projectId)}/version?loaders=${loaders}&game_versions=${versions}&featured=true`;
}

export type ModrinthVersionLike = {
  id: string;
  version_number: string;
  files: { url: string; filename: string; primary: boolean; hashes?: { sha512?: string } }[];
};

/**
 * Modrinth lists versions newest-first; the latest usable one is the
 * first with a primary file (falling back to any file).
 */
export function pickLatestVersion(versions: ModrinthVersionLike[]): { versionId: string; versionNumber: string; url: string; filename: string; sha512?: string } | null {
  for (const version of versions) {
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (file) return { versionId: version.id, versionNumber: version.version_number, url: file.url, filename: file.filename, sha512: file.hashes?.sha512 };
  }
  return null;
}

export type InstalledAddonLike = { id: number; name: string; version: string; projectId: string };
export type AddonUpdateCheck = {
  addonId: number;
  name: string;
  installed: string;
  latest: string | null;
  status: AddonUpdateStatus;
};

/** Per-addon verdicts; addons without a project id (manual files) are "unknown". */
export function planAddonUpdates(
  installed: InstalledAddonLike[],
  latestByProject: Record<string, { versionNumber: string } | null>
): AddonUpdateCheck[] {
  return installed.map((addon) => {
    const latest = addon.projectId ? latestByProject[addon.projectId] ?? null : null;
    if (!latest) return { addonId: addon.id, name: addon.name, installed: addon.version, latest: null, status: "unknown" };
    return {
      addonId: addon.id,
      name: addon.name,
      installed: addon.version,
      latest: latest.versionNumber,
      status: compareAddonVersions(addon.version, latest.versionNumber),
    };
  });
}
