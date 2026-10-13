// Unit suite for import/adopt of existing server directories: game
// detection from executable fingerprints, adoption-path validation, the
// bounded directory walk, and the route/UI wiring.

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  IMPORT_SCAN_DEPTH,
  IMPORT_SCAN_LIMIT,
  IMPORT_SIGNATURES,
  detectGameFromFiles,
  listImportCandidates,
  normalizeRelPath,
  validateImportPath,
} from "../src/lib/server-import";
import { getGame } from "../src/lib/games";

test("every import signature maps to a real catalog game and detection matches launchable executables", () => {
  for (const signature of IMPORT_SIGNATURES) {
    assert.ok(getGame(signature.gameId).id === signature.gameId, `${signature.gameId} exists in the catalog`);
    assert.ok(signature.markers.length > 0);
    for (const marker of signature.markers) assert.equal(marker, normalizeRelPath(marker), "markers are pre-normalized");
  }
  assert.equal(detectGameFromFiles(["PalServer.exe", "steam_appid.txt"]), "palworld");
  assert.equal(detectGameFromFiles(["valheim_server.x86_64"]), "valheim");
  assert.equal(detectGameFromFiles(["ShooterGame\\Binaries\\Win64\\ShooterGameServer.exe"]), "ark", "backslash paths normalize");
  assert.equal(detectGameFromFiles(["./bedrock_server.exe"]), "minecraft-bedrock");
  assert.equal(detectGameFromFiles(["Server/HytaleServer.jar"]), "hytale");
  assert.equal(detectGameFromFiles(["server.jar", "eula.txt"]), "minecraft");
  assert.equal(detectGameFromFiles(["readme.txt", "save.dat"]), null);
  assert.equal(detectGameFromFiles([]), null);
});

test("specific fingerprints win over generic ones", () => {
  // A modded Palworld folder can contain stray jars; the Palworld
  // executable must outrank the generic server.jar signature.
  assert.equal(detectGameFromFiles(["server.jar", "PalServer.exe"]), "palworld");
  const palworld = IMPORT_SIGNATURES.findIndex((s) => s.gameId === "palworld");
  const minecraft = IMPORT_SIGNATURES.findIndex((s) => s.gameId === "minecraft");
  assert.ok(palworld < minecraft, "signature order is most-specific first");
});

test("adoption paths are validated: absolute, outside appdata, unclaimed", () => {
  const appData = path.resolve("/opt/hub-appdata");
  const opts = { appData, claimed: [path.resolve("/srv/taken")] };
  assert.equal(validateImportPath(path.resolve("/srv/fresh"), opts), null);
  assert.match(validateImportPath("", opts) ?? "", /required/i);
  assert.match(validateImportPath("relative/folder", opts) ?? "", /absolute/i);
  assert.match(validateImportPath(appData, opts) ?? "", /managed by Server Hub/i);
  assert.match(validateImportPath(path.join(appData, "servers", "3"), opts) ?? "", /managed by Server Hub/i);
  assert.match(validateImportPath(path.resolve("/srv/taken"), opts) ?? "", /already uses/i);
  assert.equal(validateImportPath(path.resolve("/opt/hub-appdata-sibling"), opts), null, "sibling prefixes are not inside appdata");
});

test("the directory walk is bounded and finds nested executables", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hub-import-"));
  await fsp.mkdir(path.join(base, "ShooterGame", "Binaries", "Win64"), { recursive: true });
  await fsp.writeFile(path.join(base, "ShooterGame", "Binaries", "Win64", "ShooterGameServer.exe"), "");
  await fsp.mkdir(path.join(base, "a", "b", "c", "d"), { recursive: true }); // beyond depth
  await fsp.writeFile(path.join(base, "a", "b", "c", "d", "deep.txt"), "");
  const files = await listImportCandidates(base);
  assert.ok(files.some((f) => normalizeRelPath(f) === "shootergame/binaries/win64/shootergameserver.exe"), "depth-3 executable found");
  assert.ok(!files.some((f) => f.endsWith("deep.txt")), "depth is capped");
  assert.equal(detectGameFromFiles(files), "ark");
  assert.ok(IMPORT_SCAN_DEPTH >= 3, "deep enough for Unreal-style layouts");
  assert.ok(IMPORT_SCAN_LIMIT >= 1000, "large server folders fit the scan budget");
  await fsp.rm(base, { recursive: true, force: true });
});

test("routes and UI are wired: adopt never installs, UI offers the import flow", () => {
  const importRoute = fs.readFileSync("src/app/api/servers/import/route.ts", "utf8");
  assert.ok(!importRoute.includes("installFlow"), "adoption must never trigger installation");
  assert.ok(importRoute.includes('status: "offline"'), "adopted servers start offline and ready");
  assert.ok(importRoute.includes("managedDirectory: false"), "adopted folders stay unmanaged");
  assert.ok(importRoute.includes("validateImportPath"), "path validation is enforced");
  assert.ok(importRoute.includes("eulaAccepted !== true"), "Minecraft adoption still requires the EULA");
  const inspectRoute = fs.readFileSync("src/app/api/servers/import/inspect/route.ts", "utf8");
  assert.ok(inspectRoute.includes("detectGameFromFiles"), "inspection fingerprints the folder");
  const view = fs.readFileSync("src/components/servers-view.tsx", "utf8");
  assert.ok(view.includes("Import existing"), "the Servers view offers the entry point");
  assert.ok(view.includes("/api/servers/import/inspect"), "inspect-before-adopt flow");
  assert.ok(view.includes("Adopt server"), "the confirm step exists");
  console.log("SERVER_IMPORT_SUITE_OK");
});
