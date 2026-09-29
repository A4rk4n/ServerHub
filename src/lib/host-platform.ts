/**
 * Runtime platform for portable builds. Next may compile server bundles on a
 * different OS and constant-fold process.platform, so the native launcher
 * provides the actual target explicitly.
 */
export function hostPlatform(): NodeJS.Platform {
  const target = process.env.SERVERHUB_TARGET_PLATFORM;
  if (target === "win32" || target === "linux" || target === "darwin") return target;
  return process.platform;
}

export function isWindowsHost() { return hostPlatform() === "win32"; }
