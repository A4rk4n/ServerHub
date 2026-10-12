// CurseForge integration (curseforge.ts): URL builders, file picking,
// SHA-1 extraction, version identity, key masking, and the pins that
// hold the search/install/update/sweep wiring together.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  cfFilesUrl,
  cfModUrl,
  cfSearchUrl,
  cfSha1,
  isCurseforgeAddon,
  maskApiKey,
  normalizeCurseforgeKey,
  pickLatestCurseforgeFile,
  requiredDependencyIds,
  versionFromFileName,
} from "../src/lib/curseforge";

const BASE = "https://api.curseforge.com/v1";

test("URL builders pin Minecraft + Mods + Fabric and encode the query", () => {
  const search = cfSearchUrl(BASE, "lithium & friends", "1.21.1");
  assert.ok(search.startsWith(`${BASE}/mods/search?`));
  assert.ok(search.includes("gameId=432"), "gameId 432 is Minecraft");
  assert.ok(search.includes("classId=6"), "classId 6 is the Mods section");
  assert.ok(search.includes("modLoaderType=4"), "modLoaderType 4 is Fabric");
  assert.ok(search.includes("gameVersion=1.21.1"));
  assert.ok(search.includes("searchFilter=lithium+%26+friends"), "query is form-encoded");
  assert.equal(cfModUrl(BASE, "238222"), `${BASE}/mods/238222`);
  const files = cfFilesUrl(BASE, "238222", "1.21.1");
  assert.ok(files.startsWith(`${BASE}/mods/238222/files?`) && files.includes("modLoaderType=4") && files.includes("gameVersion=1.21.1"));
});

test("pickLatestCurseforgeFile: max file id wins, even with a null downloadUrl", () => {
  const files = [
    { id: 9001, fileName: "coolmod-2.0.0.jar", downloadUrl: "https://cdn/a.jar", hashes: [{ value: "aa", algo: 1 }] },
    { id: 9007, fileName: "coolmod-2.1.0.jar", downloadUrl: null, hashes: [{ value: "bb", algo: 1 }] },
    { id: 9003, fileName: "coolmod-2.0.1.jar", downloadUrl: "https://cdn/c.jar" },
  ];
  const latest = pickLatestCurseforgeFile(files);
  assert.equal(latest?.fileId, 9007, "file ids are monotonic — response order is irrelevant");
  assert.equal(latest?.versionNumber, "coolmod-2.1.0");
  assert.equal(latest?.url, null, "a denied download still identifies the latest version");
  assert.equal(pickLatestCurseforgeFile([]), null);
  assert.equal(pickLatestCurseforgeFile([{ id: Number.NaN, fileName: 3 } as never]), null, "malformed entries are dropped");
});

test("cfSha1 picks algo 1 only; version identity strips just the extension", () => {
  assert.equal(cfSha1({ id: 1, fileName: "x.jar", hashes: [{ value: "md5", algo: 2 }, { value: "sha", algo: 1 }] }), "sha");
  assert.equal(cfSha1({ id: 1, fileName: "x.jar", hashes: [{ value: "md5", algo: 2 }] }), undefined, "MD5 is never used for verification");
  assert.equal(cfSha1({ id: 1, fileName: "x.jar" }), undefined);
  assert.equal(versionFromFileName("lithium-fabric-mc1.21.1-0.14.3.jar"), "lithium-fabric-mc1.21.1-0.14.3");
  assert.equal(versionFromFileName("pack.ZIP"), "pack");
  assert.equal(versionFromFileName("weird.name.jar"), "weird.name");
});

test("key normalization and masking never leak the key", () => {
  assert.equal(normalizeCurseforgeKey("  $2a$10$abcdef  "), "$2a$10$abcdef");
  assert.equal(normalizeCurseforgeKey(12345), "");
  assert.equal(normalizeCurseforgeKey("x".repeat(400)).length, 256, "keys are capped");
  assert.equal(maskApiKey(""), "");
  assert.equal(maskApiKey("short"), "••••••••", "short keys reveal nothing");
  const masked = maskApiKey("$2a$10$abcdefghijklmnopqrstuv1234");
  assert.equal(masked, "••••••••1234");
  assert.ok(!masked.includes("abcdef"));
});

test("isCurseforgeAddon routes by source prefix", () => {
  assert.equal(isCurseforgeAddon("CurseForge"), true);
  assert.equal(isCurseforgeAddon("CurseForge dependency"), true);
  assert.equal(isCurseforgeAddon("Modrinth"), false);
  assert.equal(isCurseforgeAddon("Manual upload"), false);
});

test("requiredDependencyIds keeps only relationType 3, deduplicated", () => {
  const file = {
    id: 1,
    fileName: "coolmod-2.1.0.jar",
    dependencies: [
      { modId: 888, relationType: 3 },
      { modId: 999, relationType: 2 }, // optional — never forced
      { modId: 888, relationType: 3 }, // duplicate
      { modId: 555, relationType: 5 }, // incompatible — certainly not
      { modId: Number.NaN, relationType: 3 }, // malformed
      { modId: 777, relationType: 3 },
    ],
  };
  assert.deepEqual(requiredDependencyIds(file), [888, 777]);
  assert.deepEqual(requiredDependencyIds({ id: 1, fileName: "x.jar" }), [], "no dependency array means no requirements");
  const latest = pickLatestCurseforgeFile([file]);
  assert.deepEqual(latest?.requiredDependencies, [888, 777], "the picked file carries its requirements");
});

test("wiring pins: search/install branch, update route, sweep, key sidecar, UI", () => {
  const addonsRoute = fs.readFileSync("src/app/api/servers/[id]/addons/route.ts", "utf8");
  assert.ok(addonsRoute.includes('params.get("source") === "curseforge"'), "search branches on ?source=curseforge");
  assert.ok(addonsRoute.includes('"x-api-key": apiKey'), "CurseForge calls carry the key header");
  assert.ok(addonsRoute.includes("disabled third-party downloads"), "denied distribution gets a human explanation");
  assert.ok(addonsRoute.includes("latest.requiredDependencies") && addonsRoute.includes("installCfMod(String(requiredId), true)"), "required dependencies install recursively");
  assert.ok(addonsRoute.indexOf("installCfMod(String(requiredId), true)") < addonsRoute.indexOf('source: dependency ? "CurseForge dependency" : "CurseForge"'), "dependencies land before the requesting mod");
  const updatesRoute = fs.readFileSync("src/app/api/servers/[id]/addons/updates/route.ts", "utf8");
  assert.ok(updatesRoute.includes("curseforgeLatest") && updatesRoute.includes("modrinthLatest"), "update check consults both providers");
  assert.ok(updatesRoute.includes("isCurseforgeAddon(addon.source)"), "provider is chosen per addon source");
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("curseforgeLatest") && runtime.includes("readCurseforgeKey"), "the scheduled sweep covers CurseForge mods");
  const keyLib = fs.readFileSync("src/lib/curseforge-key.ts", "utf8");
  assert.ok(keyLib.includes("mode: 0o600"), "the key sidecar is written 0600");
  const ui = fs.readFileSync("src/components/addons-manager.tsx", "utf8");
  assert.ok(ui.includes('"curseforge"') && ui.includes("/api/curseforge"), "UI has the provider selector and key form");
  console.log("CURSEFORGE_SUITE_OK");
});
