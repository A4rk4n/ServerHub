import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { assertToolDownloadSize, managedToolFolder, MAX_TOOL_DOWNLOAD_BYTES, repairSupported, STEAMCMD_OFFICIAL_URL } from "../src/lib/tool-security";

test("the SteamCMD download source stays pinned to the official URL", () => {
  assert.equal(STEAMCMD_OFFICIAL_URL, "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip");
});

test("tool download size limits reject oversized and negative payloads", () => {
  assert.doesNotThrow(() => assertToolDownloadSize(MAX_TOOL_DOWNLOAD_BYTES));
  assert.throws(() => assertToolDownloadSize(MAX_TOOL_DOWNLOAD_BYTES + 1));
  assert.throws(() => assertToolDownloadSize(-1));
});

test("managedToolFolder confines tools to the managed root and reports repair support", () => {
  assert.equal(managedToolFolder("/managed/tools", "steamcmd"), path.resolve("/managed/tools/steamcmd"));
  for (const id of ["../secret", "C:\\Users\\Ahri", "java", "steamcmd/../../secret", ""]) {
    assert.throws(() => managedToolFolder("/managed/tools", id), id);
  }
  assert.equal(repairSupported("steamcmd"), true);
  assert.equal(repairSupported("java"), false);
  assert.equal(managedToolFolder("/managed/tools", "hytale-downloader"), path.resolve("/managed/tools/hytale-downloader"));
});

test("the folder route keeps Explorer visible and spawn-guarded", () => {
  const folderRoute = fs.readFileSync("src/app/api/tools/[id]/folder/route.ts", "utf8");
  for (const marker of ["await mkdir(target,{recursive:true})", "windowsHide:false", "shell:false", "child.once(\"error\"", "child.once(\"spawn\""]) {
    assert.ok(folderRoute.includes(marker), marker);
  }
  assert.ok(!folderRoute.includes("windowsHide:true"), "Explorer must remain visible");
});

test("the repair route uses the pinned URL, safe extraction, and rollback", () => {
  const route = fs.readFileSync("src/app/api/tools/[id]/repair/route.ts", "utf8");
  for (const marker of ["STEAMCMD_OFFICIAL_URL", "assertToolDownloadSize", "extractZipSafe", "maxEntries:2000", "maxExpandedBytes:500*1024*1024", "inArray(installationJobs.status", "rollback", "restoreToolRollback"]) {
    assert.ok(route.includes(marker), marker);
  }
  assert.ok(!route.includes("body.url"));
  assert.ok(fs.readFileSync("src/lib/runtime.ts", "utf8").includes("Recovery attempt ${attempt + 1}/3 scheduled"));
  console.log("TOOL_REPAIR_SECURITY_REGRESSION_OK");
});
