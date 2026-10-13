// Copy the mod set from one Fabric server to another: the files move,
// the addon rows clone, and nothing already present is touched. Pure
// planning here — which rows copy, which skip and why, and whether the
// pair of servers is a sane combination at all; the route owns the
// filesystem and the database.

export type CopyableAddon = {
  id: number;
  name: string;
  projectId: string;
  filePath: string;
  enabled: boolean;
};

export type AddonCopyPlan<T extends CopyableAddon> = {
  copy: T[];
  skipped: { name: string; reason: string }[];
};

/** Rows copy unless the target already has the project (any version —
 *  never silently overwrite someone's pinned older build) or a file
 *  with the same name; rows that track no file cannot be copied. */
export function planAddonCopy<T extends CopyableAddon>(source: T[], target: CopyableAddon[]): AddonCopyPlan<T> {
  const targetProjects = new Set(target.map((addon) => addon.projectId).filter(Boolean));
  const normalize = (filePath: string) => filePath.replace(/\.disabled$/, "");
  const targetFiles = new Set(target.map((addon) => normalize(addon.filePath)).filter(Boolean));
  const plan: AddonCopyPlan<T> = { copy: [], skipped: [] };
  for (const addon of source) {
    if (!addon.filePath) {
      plan.skipped.push({ name: addon.name, reason: "no file tracked" });
      continue;
    }
    if (addon.projectId && targetProjects.has(addon.projectId)) {
      plan.skipped.push({ name: addon.name, reason: "already installed" });
      continue;
    }
    if (targetFiles.has(normalize(addon.filePath))) {
      plan.skipped.push({ name: addon.name, reason: "a file with this name already exists" });
      continue;
    }
    plan.copy.push(addon);
  }
  return plan;
}

export type CopyPairServer = { id: number; gameId: string; loader: string; version: string };

/** Error message, or null when copying between this pair makes sense. */
export function validateCopyPair(source: CopyPairServer, target: CopyPairServer): string | null {
  if (source.id === target.id) return "Source and destination are the same server.";
  for (const server of [source, target]) {
    if (server.gameId !== "minecraft-modded" || server.loader !== "fabric") {
      return "Mod copying is available between Fabric servers.";
    }
  }
  if (source.version !== target.version) {
    // Fabric mods are built per Minecraft version; copying across
    // versions produces a server that crashes on boot.
    return `The servers run different Minecraft versions (${source.version} vs ${target.version}) — mods are not compatible across versions.`;
  }
  return null;
}
