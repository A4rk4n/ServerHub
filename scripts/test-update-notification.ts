// Unit suite for the in-app update notification: version comparison,
// GitHub release payload extraction, banner visibility, and route wiring.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  APP_VERSION,
  LATEST_RELEASE_API,
  RELEASES_PAGE,
  extractLatestRelease,
  isNewerVersion,
  parseVersion,
  shouldShowUpdateBanner,
} from "../src/lib/update-check";

test("parseVersion accepts strict x.y.z with optional v prefix and nothing else", () => {
  assert.deepEqual(parseVersion("2.21.0"), [2, 21, 0]);
  assert.deepEqual(parseVersion("v2.21.0"), [2, 21, 0]);
  assert.deepEqual(parseVersion("  v10.0.3  "), [10, 0, 3]);
  for (const bad of ["", "2.21", "2.21.0-rc.1", "2.21.0+build", "latest", "v2.21.0.1", "2..0", "v", "2.x.0"]) {
    assert.equal(parseVersion(bad), null, bad);
  }
});

test("isNewerVersion compares numerically, not lexically", () => {
  assert.equal(isNewerVersion("2.21.0", "2.22.0"), true);
  assert.equal(isNewerVersion("2.21.0", "v3.0.0"), true);
  assert.equal(isNewerVersion("2.9.9", "2.10.0"), true);
  assert.equal(isNewerVersion("2.21.0", "2.21.1"), true);
  assert.equal(isNewerVersion("2.21.0", "2.21.0"), false);
  assert.equal(isNewerVersion("2.21.0", "2.20.9"), false);
  assert.equal(isNewerVersion("2.21.0", "1.99.99"), false);
  assert.equal(isNewerVersion("garbage", "2.22.0"), false);
  assert.equal(isNewerVersion("2.21.0", "garbage"), false);
});

test("extractLatestRelease only surfaces published github.com releases with semver tags", () => {
  const good = { tag_name: "v2.22.0", html_url: "https://github.com/A4rk4n/ServerHub/releases/tag/v2.22.0", draft: false, prerelease: false, published_at: "2026-10-01T00:00:00Z" };
  assert.deepEqual(extractLatestRelease(good), {
    version: "2.22.0",
    url: "https://github.com/A4rk4n/ServerHub/releases/tag/v2.22.0",
    publishedAt: "2026-10-01T00:00:00Z",
  });
  assert.equal(extractLatestRelease({ ...good, draft: true }), null);
  assert.equal(extractLatestRelease({ ...good, prerelease: true }), null);
  assert.equal(extractLatestRelease({ ...good, tag_name: "nightly" }), null);
  assert.equal(extractLatestRelease({ ...good, tag_name: "v2.22.0-rc.1" }), null);
  assert.equal(extractLatestRelease({ ...good, html_url: "https://evil.example/release" }), null);
  assert.equal(extractLatestRelease({ ...good, html_url: 42 }), null);
  assert.equal(extractLatestRelease(null), null);
  assert.equal(extractLatestRelease("not an object"), null);
  assert.equal(extractLatestRelease({}), null);
});

test("the banner shows for a new version, respects mute, and re-arms after a dismissed version", () => {
  const update = { updateAvailable: true, latest: "2.22.0" };
  assert.equal(shouldShowUpdateBanner(update, null, false), true);
  assert.equal(shouldShowUpdateBanner(update, null, true), false);
  assert.equal(shouldShowUpdateBanner(update, "2.22.0", false), false);
  assert.equal(shouldShowUpdateBanner(update, "2.21.5", false), true);
  assert.equal(shouldShowUpdateBanner({ updateAvailable: false, latest: null }, null, false), false);
  assert.equal(shouldShowUpdateBanner({ updateAvailable: false, latest: "2.20.0" }, null, false), false);
});

test("the app version and release endpoints stay consistent with the package", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(APP_VERSION, pkg.version);
  assert.ok(LATEST_RELEASE_API.startsWith("https://api.github.com/repos/A4rk4n/ServerHub/"));
  assert.ok(RELEASES_PAGE.startsWith("https://github.com/A4rk4n/ServerHub/"));
});

test("the update-check route is cached, bounded, and fails closed", () => {
  const route = fs.readFileSync("src/app/api/update-check/route.ts", "utf8");
  assert.ok(route.includes("AbortSignal.timeout"), "network call must be bounded");
  assert.ok(route.includes("OK_TTL_MS"), "successful checks are cached");
  assert.ok(route.includes("FAIL_TTL_MS"), "failures are cached for a shorter period");
  assert.ok(route.includes("extractLatestRelease"), "payload goes through the defensive extractor");
  assert.ok(route.includes("catch"), "network errors must not fail the endpoint");
  const shell = fs.readFileSync("src/components/shell.tsx", "utf8");
  assert.ok(shell.includes("UpdateBanner"), "the shell renders the banner on every page");
  assert.equal(shell.includes("v1.0.2"), false, "the stale hardcoded sidebar version is gone");
  console.log("UPDATE_NOTIFICATION_SUITE_OK");
});
