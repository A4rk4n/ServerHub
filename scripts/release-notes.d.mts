// Type declarations for scripts/release-notes.mjs (tsconfig has allowJs: false).

export function normalizeVersion(version: string): string;
export function extractReleaseNotes(changelog: string, version: string): string;
export function checkReleaseConsistency(input: {
  packageJson: string;
  packageLock: string;
  changelog: string;
}): { version: string; problems: string[] };
