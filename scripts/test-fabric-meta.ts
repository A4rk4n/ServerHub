// Regression suite for Fabric meta resolution. The per-game loader list
// (/v2/versions/loader/:game) contains NO installer field; the previous
// code assumed one and crashed every Fabric installation with
// "Cannot read properties of undefined (reading 'stable')".

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { FABRIC_INSTALLER_LIST_URL, fabricLoaderListUrl, fabricServerJarUrl, pickFabricInstaller, pickFabricLoader } from "../src/lib/fabric-meta";

// Exactly what meta.fabricmc.net returns for a game version: loader +
// intermediary only. No installer key anywhere.
const REAL_LOADER_PAYLOAD = [
  { loader: { separator: ".", build: 17, maven: "net.fabricmc:fabric-loader:0.17.2", version: "0.17.2", stable: true }, intermediary: { maven: "net.fabricmc:intermediary:1.21.8", version: "1.21.8", stable: true } },
  { loader: { separator: ".", build: 16, maven: "net.fabricmc:fabric-loader:0.17.1", version: "0.17.1", stable: false }, intermediary: { maven: "net.fabricmc:intermediary:1.21.8", version: "1.21.8", stable: true } },
];

test("the real loader payload (no installer field) resolves instead of crashing", () => {
  assert.equal(pickFabricLoader(REAL_LOADER_PAYLOAD), "0.17.2");
});

test("stable loaders are preferred; newest of any kind is the fallback", () => {
  const noStable = [
    { loader: { version: "0.18.0-beta.2", stable: false } },
    { loader: { version: "0.18.0-beta.1", stable: false } },
  ];
  assert.equal(pickFabricLoader(noStable), "0.18.0-beta.2");
  const stableSecond = [
    { loader: { version: "0.18.0-beta.1", stable: false } },
    { loader: { version: "0.17.2", stable: true } },
  ];
  assert.equal(pickFabricLoader(stableSecond), "0.17.2");
});

test("malformed loader payloads yield null, never a throw", () => {
  assert.equal(pickFabricLoader([]), null);
  assert.equal(pickFabricLoader(null), null);
  assert.equal(pickFabricLoader("nope"), null);
  assert.equal(pickFabricLoader([{}]), null);
  assert.equal(pickFabricLoader([{ loader: { stable: true } }]), null, "a loader without a version string is unusable");
  assert.equal(pickFabricLoader([{ loader: null }, { loader: { version: "0.17.2", stable: true } }]), "0.17.2");
});

test("installer versions come from their own endpoint and shape", () => {
  const payload = [
    { url: "https://maven.fabricmc.net/...", maven: "net.fabricmc:fabric-installer:1.1.0", version: "1.1.0", stable: false },
    { url: "https://maven.fabricmc.net/...", maven: "net.fabricmc:fabric-installer:1.0.3", version: "1.0.3", stable: true },
  ];
  assert.equal(pickFabricInstaller(payload), "1.0.3", "stable installer wins over a newer pre-release");
  assert.equal(pickFabricInstaller([]), null);
  assert.equal(pickFabricInstaller(undefined), null);
  assert.equal(FABRIC_INSTALLER_LIST_URL, "https://meta.fabricmc.net/v2/versions/installer");
});

test("urls encode versions and the runtime uses the shared resolver", () => {
  assert.equal(fabricLoaderListUrl("1.14 Pre-Release 5"), "https://meta.fabricmc.net/v2/versions/loader/1.14%20Pre-Release%205");
  assert.equal(fabricServerJarUrl("1.21.8", "0.17.2", "1.0.3"), "https://meta.fabricmc.net/v2/versions/loader/1.21.8/0.17.2/1.0.3/server/jar");
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("pickFabricLoader"), "installFabric resolves the loader via the tested helper");
  assert.ok(runtime.includes("pickFabricInstaller"), "installFabric resolves the installer via the tested helper");
  assert.ok(runtime.includes("FABRIC_INSTALLER_LIST_URL"), "the installer list is fetched from its own endpoint");
  assert.ok(!runtime.includes("item.installer.stable"), "the crashing field access is gone");
  console.log("FABRIC_META_RESOLUTION_OK");
});
