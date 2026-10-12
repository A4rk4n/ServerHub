// Addon update checker (F58, v2.71.0) — version parsing and ordering
// over real Modrinth version shapes (v-prefixes, +build metadata,
// -pre-release tails, downgrade bait), latest-pick with primary-file
// preference, the per-addon plan, and pinned wiring: the updates
// route (checksum gate, safe paths, old-file retirement order) and
// the manager UI.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareAddonVersions, parseModVersion, pickLatestVersion, planAddonUpdates } from "../src/lib/addon-updates";

test("parseModVersion handles real Modrinth shapes", () => {
  assert.deepEqual(parseModVersion("1.2.3"), { nums: [1, 2, 3], tail: "" });
  assert.deepEqual(parseModVersion("v2.0"), { nums: [2, 0], tail: "" });
  assert.deepEqual(parseModVersion("1.2.3+1.21.1"), { nums: [1, 2, 3], tail: "+1.21.1" });
  assert.deepEqual(parseModVersion("1.2.3-beta.2"), { nums: [1, 2, 3], tail: "-beta.2" });
  assert.equal(parseModVersion("nightly-build"), null, "no leading number means unorderable");
});

test("compareAddonVersions orders when it can and never flags downgrades", () => {
  assert.equal(compareAddonVersions("1.0.0", "1.1.0"), "update");
  assert.equal(compareAddonVersions("1.1.0", "1.1.0"), "current");
  assert.equal(compareAddonVersions("1.2.0", "1.1.9"), "current", "a featured version older than installed is not an update");
  assert.equal(compareAddonVersions("1.9", "1.10"), "update", "numeric segments, not string order");
  assert.equal(compareAddonVersions("v1.0.0", "1.0.1"), "update", "v-prefix is cosmetic");
  assert.equal(compareAddonVersions("1.2.3-beta.2", "1.2.3"), "update", "release beats its own pre-release");
  assert.equal(compareAddonVersions("1.2.3", "1.2.3-rc.1"), "current", "never downgrade to a pre-release");
  assert.equal(compareAddonVersions("1.2.3+1.21", "1.2.3+1.21"), "current");
  assert.equal(compareAddonVersions("fabric-nightly", "1.0.0"), "update", "unorderable but different is surfaced");
  assert.equal(compareAddonVersions("weird-tag", "weird-tag"), "current");
});

test("pickLatestVersion prefers the primary file of the newest version", () => {
  const picked = pickLatestVersion([
    {
      id: "vNew",
      version_number: "2.0.0",
      files: [
        { url: "https://cdn/sources.jar", filename: "sources.jar", primary: false },
        { url: "https://cdn/mod-2.0.0.jar", filename: "mod-2.0.0.jar", primary: true, hashes: { sha512: "abc" } },
      ],
    },
    { id: "vOld", version_number: "1.0.0", files: [{ url: "https://cdn/mod-1.0.0.jar", filename: "mod-1.0.0.jar", primary: true }] },
  ]);
  assert.deepEqual(picked, { versionId: "vNew", versionNumber: "2.0.0", url: "https://cdn/mod-2.0.0.jar", filename: "mod-2.0.0.jar", sha512: "abc" });
  assert.equal(pickLatestVersion([]), null);
  const noPrimary = pickLatestVersion([{ id: "v", version_number: "1.0", files: [{ url: "u", filename: "f.jar", primary: false }] }]);
  assert.equal(noPrimary!.filename, "f.jar", "falls back to any file");
});

test("planAddonUpdates: manual installs and unreachable projects are unknown", () => {
  const plan = planAddonUpdates(
    [
      { id: 1, name: "Lithium", version: "1.0.0", projectId: "lith" },
      { id: 2, name: "Manual Jar", version: "0.1", projectId: "" },
      { id: 3, name: "Gone", version: "2.0", projectId: "gone" },
    ],
    { lith: { versionNumber: "1.1.0" }, gone: null }
  );
  assert.deepEqual(plan.map((p) => [p.addonId, p.status, p.latest]), [
    [1, "update", "1.1.0"],
    [2, "unknown", null],
    [3, "unknown", null],
  ]);
});

test("wiring is pinned: route safety order, test hook, manager UI", () => {
  const route = readFileSync("src/app/api/servers/[id]/addons/updates/route.ts", "utf8");
  assert.ok(route.includes('process.env.SERVERHUB_MODRINTH_BASE ?? "https://api.modrinth.com/v2"'), "base URL is overridable for tests only");
  assert.ok(route.includes("Downloaded mod failed its checksum — nothing was changed"), "sha512 gate before anything is replaced");
  assert.ok(route.indexOf("await download(") < route.indexOf("only now retire the old one"), "new file lands before the old one is removed");
  assert.ok(route.includes("The mod filename is not a safe path"));
  assert.ok(route.includes("installed manually — update it by replacing its file"), "manual installs get a clear 409");
  const ui = readFileSync("src/components/addons-manager.tsx", "utf8");
  assert.ok(ui.includes("Check for updates"));
  assert.ok(ui.includes("addons/updates"));
  assert.ok(ui.includes("Update to ${checks[a.id].latest}"));
  console.log("ADDON_UPDATES_SUITE_OK");
});
