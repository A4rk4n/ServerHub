#!/usr/bin/env node
// Release-notes extraction and release-consistency checking against
// CHANGELOG.md (Keep a Changelog format).
//
// CLI:
//   node scripts/release-notes.mjs extract <version> [root]
//     Prints the CHANGELOG section body for <version> ("2.14.0" or
//     "v2.14.0") to stdout. Fails if the section is missing or empty.
//   node scripts/release-notes.mjs check [root]
//     Verifies that package.json, package-lock.json, and CHANGELOG.md
//     agree on the current version: matching lockfile versions, a
//     dated changelog entry with a non-empty body, a link definition
//     for the version, and an [Unreleased] link comparing from it.
//
// Dependency-free; doubles as a library for scripts/test-release-notes.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Normalize "v2.14.0" -> "2.14.0". */
export function normalizeVersion(version) {
  return version.replace(/^v/, "");
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Extract the body of the `## [version] - date` section from a Keep a
 * Changelog document. Returns the trimmed markdown between that heading
 * and the next `## ` heading or link-definition block.
 */
export function extractReleaseNotes(changelog, version) {
  const wanted = normalizeVersion(version);
  const lines = changelog.split("\n");
  const headingPattern = new RegExp(
    `^##\\s+\\[${escapeRegExp(wanted)}\\](\\s+-\\s+\\d{4}-\\d{2}-\\d{2})?\\s*$`
  );
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no "## [${wanted}]" section.`);
  }
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^##\s+\[/.test(line)) break; // next release section
    if (/^\[[^\]]+\]:\s+\S+/.test(line)) break; // link definitions
    body.push(line);
  }
  const notes = body.join("\n").trim();
  if (!notes) {
    throw new Error(`CHANGELOG.md section "## [${wanted}]" is empty.`);
  }
  return notes;
}

/**
 * Check that the repository's release metadata is internally consistent.
 * Accepts raw file contents so the unit suite can exercise it against
 * fixtures. Returns { version, problems: string[] }.
 */
export function checkReleaseConsistency({ packageJson, packageLock, changelog }) {
  const problems = [];
  const pkg = JSON.parse(packageJson);
  const lock = JSON.parse(packageLock);
  const version = pkg.version;

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    problems.push(`package.json version "${version}" is not a semantic version.`);
    return { version, problems };
  }
  if (lock.version !== version) {
    problems.push(
      `package-lock.json version "${lock.version}" does not match package.json "${version}".`
    );
  }
  const lockRoot = lock.packages?.[""]?.version;
  if (lockRoot !== version) {
    problems.push(
      `package-lock.json packages[""].version "${lockRoot}" does not match package.json "${version}".`
    );
  }

  const headingPattern = new RegExp(
    `^##\\s+\\[${escapeRegExp(version)}\\]\\s+-\\s+\\d{4}-\\d{2}-\\d{2}\\s*$`,
    "m"
  );
  if (!headingPattern.test(changelog)) {
    problems.push(`CHANGELOG.md has no dated "## [${version}] - YYYY-MM-DD" entry.`);
  } else {
    try {
      extractReleaseNotes(changelog, version);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  const linkPattern = new RegExp(`^\\[${escapeRegExp(version)}\\]:\\s+\\S+`, "m");
  if (!linkPattern.test(changelog)) {
    problems.push(`CHANGELOG.md has no "[${version}]: ..." link definition.`);
  }
  const unreleasedPattern = new RegExp(
    `^\\[Unreleased\\]:\\s+\\S*v${escapeRegExp(version)}\\.\\.\\.HEAD\\s*$`,
    "m"
  );
  if (!unreleasedPattern.test(changelog)) {
    problems.push(
      `CHANGELOG.md [Unreleased] link does not compare from v${version} to HEAD.`
    );
  }

  return { version, problems };
}

function readRepoFiles(root) {
  return {
    packageJson: readFileSync(path.join(root, "package.json"), "utf8"),
    packageLock: readFileSync(path.join(root, "package-lock.json"), "utf8"),
    changelog: readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "extract") {
    const [version, rootArg] = rest;
    if (!version) {
      console.error("Usage: release-notes.mjs extract <version> [root]");
      process.exit(2);
    }
    const root = path.resolve(rootArg ?? ".");
    const { changelog } = readRepoFiles(root);
    process.stdout.write(`${extractReleaseNotes(changelog, version)}\n`);
  } else if (mode === "check") {
    const root = path.resolve(rest[0] ?? ".");
    const { version, problems } = checkReleaseConsistency(readRepoFiles(root));
    if (problems.length > 0) {
      for (const problem of problems) console.error(`release-consistency: ${problem}`);
      process.exit(1);
    }
    console.log(`RELEASE_CONSISTENCY_OK ${version}`);
  } else {
    console.error("Usage: release-notes.mjs <extract|check> ...");
    process.exit(2);
  }
}
