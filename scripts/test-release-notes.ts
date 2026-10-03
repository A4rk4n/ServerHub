// Unit suite for scripts/release-notes.mjs: Keep-a-Changelog section
// extraction and release-metadata consistency checking. Also asserts the
// repository's own release metadata is consistent, so a version bump that
// forgets the CHANGELOG entry or lockfile fails the unit pass locally.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkReleaseConsistency,
  extractReleaseNotes,
  normalizeVersion,
} from "./release-notes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fixtureChangelog = `# Changelog

## [Unreleased]

## [2.0.0] - 2026-02-01

### Added
- Second feature.

## [1.2.3] - 2026-01-01

### Added
- First feature.

### Fixed
- A bug.

## [1.0.0] - 2025-12-01

[Unreleased]: https://example.com/compare/v2.0.0...HEAD
[2.0.0]: https://example.com/compare/v1.2.3...v2.0.0
[1.2.3]: https://example.com/compare/v1.0.0...v1.2.3
[1.0.0]: https://example.com/releases/tag/v1.0.0
`;

const fixturePackage = (version: string) => JSON.stringify({ name: "x", version });
const fixtureLock = (version: string, rootVersion = version) =>
  JSON.stringify({ name: "x", version, packages: { "": { name: "x", version: rootVersion } } });

test("normalizeVersion strips a leading v", () => {
  assert.equal(normalizeVersion("v2.14.0"), "2.14.0");
  assert.equal(normalizeVersion("2.14.0"), "2.14.0");
});

test("extractReleaseNotes returns one version's section body", () => {
  const notes = extractReleaseNotes(fixtureChangelog, "1.2.3");
  assert.ok(notes.includes("First feature."));
  assert.ok(notes.includes("### Fixed"));
  assert.ok(!notes.includes("Second feature."));
  assert.ok(!notes.includes("[Unreleased]:"));
  assert.equal(extractReleaseNotes(fixtureChangelog, "v1.2.3"), notes);
});

test("extractReleaseNotes stops before the link-definition block", () => {
  const notes = extractReleaseNotes(fixtureChangelog, "2.0.0");
  assert.equal(notes, "### Added\n- Second feature.");
});

test("extractReleaseNotes rejects missing and empty sections", () => {
  assert.throws(() => extractReleaseNotes(fixtureChangelog, "9.9.9"), /no "## \[9\.9\.9\]"/);
  assert.throws(() => extractReleaseNotes(fixtureChangelog, "1.0.0"), /is empty/);
});

test("checkReleaseConsistency accepts a consistent repository", () => {
  const { version, problems } = checkReleaseConsistency({
    packageJson: fixturePackage("2.0.0"),
    packageLock: fixtureLock("2.0.0"),
    changelog: fixtureChangelog,
  });
  assert.equal(version, "2.0.0");
  assert.deepEqual(problems, []);
});

test("checkReleaseConsistency reports each inconsistency", () => {
  const mismatchedLock = checkReleaseConsistency({
    packageJson: fixturePackage("2.0.0"),
    packageLock: fixtureLock("1.2.3"),
    changelog: fixtureChangelog,
  });
  assert.equal(mismatchedLock.problems.length, 2);
  assert.match(mismatchedLock.problems[0], /package-lock\.json version/);
  assert.match(mismatchedLock.problems[1], /packages\[""\]\.version/);

  const missingEntry = checkReleaseConsistency({
    packageJson: fixturePackage("3.0.0"),
    packageLock: fixtureLock("3.0.0"),
    changelog: fixtureChangelog,
  });
  assert.ok(missingEntry.problems.some((p) => p.includes('no dated "## [3.0.0]')));
  assert.ok(missingEntry.problems.some((p) => p.includes('no "[3.0.0]: ..." link')));
  assert.ok(missingEntry.problems.some((p) => p.includes("[Unreleased] link")));

  const undatedEntry = checkReleaseConsistency({
    packageJson: fixturePackage("1.0.0"),
    packageLock: fixtureLock("1.0.0"),
    changelog: fixtureChangelog,
  });
  assert.ok(undatedEntry.problems.some((p) => p.includes("[Unreleased] link")));

  const badSemver = checkReleaseConsistency({
    packageJson: fixturePackage("not-a-version"),
    packageLock: fixtureLock("not-a-version"),
    changelog: fixtureChangelog,
  });
  assert.equal(badSemver.problems.length, 1);
  assert.match(badSemver.problems[0], /not a semantic version/);
});

test("the repository's own release metadata is consistent", () => {
  const { version, problems } = checkReleaseConsistency({
    packageJson: readFileSync(path.join(root, "package.json"), "utf8"),
    packageLock: readFileSync(path.join(root, "package-lock.json"), "utf8"),
    changelog: readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
  });
  assert.deepEqual(problems, [], problems.join("; "));
  const notes = extractReleaseNotes(
    readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
    version
  );
  assert.ok(notes.length > 0);
  console.log("RELEASE_NOTES_SUITE_OK", version);
});
