// Pure logic for the in-app update notification: semantic-version
// comparison, GitHub release payload extraction, and banner visibility.
// Kept free of fetch/React so every decision is unit testable.

import packageJson from "../../package.json";

export const APP_VERSION: string = packageJson.version;
export const RELEASES_PAGE = "https://github.com/A4rk4n/ServerHub/releases";
export const LATEST_RELEASE_API = "https://api.github.com/repos/A4rk4n/ServerHub/releases/latest";

export type LatestRelease = { version: string; url: string; publishedAt: string | null };

// Strict x.y.z with an optional leading v. Pre-releases and build metadata
// are rejected on purpose: the app only ever notifies about full releases.
export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const a = parseVersion(current);
  const b = parseVersion(candidate);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (b[i] !== a[i]) return b[i] > a[i];
  }
  return false;
}

// Accepts the GitHub "latest release" API payload. Defensive on every
// field: only a published (non-draft, non-prerelease) release with a
// strict semver tag and a github.com release URL is ever surfaced.
export function extractLatestRelease(payload: unknown): LatestRelease | null {
  if (typeof payload !== "object" || payload === null) return null;
  const release = payload as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; published_at?: unknown };
  if (release.draft === true || release.prerelease === true) return null;
  if (typeof release.tag_name !== "string" || !parseVersion(release.tag_name)) return null;
  if (typeof release.html_url !== "string" || !release.html_url.startsWith("https://github.com/")) return null;
  return {
    version: release.tag_name.replace(/^v/, ""),
    url: release.html_url,
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
  };
}

// The banner shows only when a newer release exists, checks are not muted,
// and that exact version has not been dismissed. Dismissing one version
// keeps the banner armed for the next release.
export function shouldShowUpdateBanner(
  status: { updateAvailable: boolean; latest: string | null },
  dismissedVersion: string | null,
  muted: boolean
): boolean {
  return !muted && status.updateAvailable && status.latest !== null && status.latest !== dismissedVersion;
}
