// Manual mod upload: drop a .jar into the manager and get a tracked
// addon row — enable/disable, uninstall and the file manager all treat
// it exactly like a store install. Update checks report "manual"
// uploads as unknown by design (projectId stays empty). Pure validation
// here; the route owns multipart parsing and the filesystem.

/** Generous but bounded — the largest mainstream content mods are
 *  well under this, and a runaway upload must not fill the disk. */
export const MAX_MOD_UPLOAD_BYTES = 100 * 1024 * 1024;

const NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._ +-]{0,199}\.(jar|zip)$/i;

/** Error message, or null when the file name is acceptable. The name
 *  must already be a bare basename — anything path-like is rejected,
 *  not repaired, so nothing the user did not type can be written. */
export function validateModUploadName(name: unknown): string | null {
  if (typeof name !== "string" || name.length === 0) return "The upload has no file name.";
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return "The file name must not contain path separators.";
  if (!NAME_SHAPE.test(name)) return "Mod files are .jar or .zip, up to 200 characters, starting with a letter or digit.";
  return null;
}

/** "lithium-fabric-0.14.3.jar" → "lithium-fabric-0.14.3". */
export function modNameFromFileName(fileName: string): string {
  return fileName.replace(/\.(jar|zip)$/i, "");
}
