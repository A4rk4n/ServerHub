// Unit suite for game-server update alerts: SteamCMD manifest parsing,
// app-info payload extraction, conservative build comparison, and the
// route/badge wiring.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { appManifestName, compareBuilds, extractLatestBuildId, parseAppManifestBuildId, steamAppInfoUrl } from "../src/lib/game-updates";

const MANIFEST = `"AppState"
{
\t"appid"\t\t"2394010"
\t"Universe"\t\t"1"
\t"name"\t\t"Palworld Dedicated Server"
\t"StateFlags"\t\t"4"
\t"installdir"\t\t"PalServer"
\t"buildid"\t\t"15102939"
\t"LastOwner"\t\t"0"
}`;

test("the installed build id is read from SteamCMD's app manifest", () => {
  assert.equal(parseAppManifestBuildId(MANIFEST), "15102939");
  assert.equal(parseAppManifestBuildId('"buildid" "42"'), "42");
  assert.equal(parseAppManifestBuildId('"buildid" "not-a-number"'), null);
  assert.equal(parseAppManifestBuildId("no manifest content"), null);
  assert.equal(parseAppManifestBuildId(""), null);
  assert.equal(appManifestName(2394010), "appmanifest_2394010.acf");
});

test("the latest public build id is extracted defensively from app-info payloads", () => {
  const payload = { data: { "2394010": { depots: { branches: { public: { buildid: "15200000", timeupdated: "1790000000" } } } } } };
  assert.deepEqual(extractLatestBuildId(payload, 2394010), { buildId: "15200000", timeUpdated: "1790000000" });
  assert.equal(extractLatestBuildId(payload, 1690800), null, "wrong app id yields null");
  assert.equal(extractLatestBuildId({ data: { "2394010": {} } }, 2394010), null);
  assert.equal(extractLatestBuildId({ data: { "2394010": { depots: { branches: { public: { buildid: 15200000 } } } } } }, 2394010), null, "numeric buildid type is rejected");
  assert.equal(extractLatestBuildId({ data: { "2394010": { depots: { branches: { public: { buildid: "evil; rm -rf" } } } } } }, 2394010), null);
  assert.equal(extractLatestBuildId(null, 2394010), null);
  assert.equal(extractLatestBuildId("nope", 2394010), null);
});

test("build comparison is conservative: alerts only on a strictly newer latest build", () => {
  assert.equal(compareBuilds("100", "200"), "update-available");
  assert.equal(compareBuilds("200", "200"), "up-to-date");
  assert.equal(compareBuilds("300", "200"), "up-to-date", "a lagging mirror must never raise a false alert");
  assert.equal(compareBuilds(null, "200"), "unknown");
  assert.equal(compareBuilds("100", null), "unknown");
  assert.equal(compareBuilds("abc", "200"), "unknown");
  assert.equal(steamAppInfoUrl(2394010), "https://api.steamcmd.net/v1/info/2394010");
});

test("the route caches per app, bounds the lookup, and the frame shows the badge", () => {
  const lib = fs.readFileSync("src/lib/game-updates.ts", "utf8");
  assert.ok(lib.includes("OK_TTL_MS"), "successful lookups are cached");
  assert.ok(lib.includes("FAIL_TTL_MS"), "failures retry sooner");
  assert.ok(lib.includes("AbortSignal.timeout"), "the lookup is bounded");
  const route = fs.readFileSync("src/app/api/servers/[id]/game-update/route.ts", "utf8");
  assert.ok(route.includes("fetchLatestGameBuild"), "the route uses the shared cached lookup");
  assert.ok(route.includes('"not-applicable"'), "non-SteamCMD servers opt out cleanly");
  assert.ok(route.includes("compareBuilds"), "the conservative comparison is used");
  const frame = fs.readFileSync("src/components/server-frame.tsx", "utf8");
  assert.ok(frame.includes("game-update"), "the server frame polls the route");
  assert.ok(frame.includes("update-available"), "the badge renders only on a real update");
  console.log("GAME_UPDATE_ALERTS_OK");
});
