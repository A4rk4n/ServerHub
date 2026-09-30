import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
const games = fs.readFileSync("src/lib/games.ts", "utf8");
const proxy = fs.readFileSync("src/proxy.ts", "utf8");
const localSecurity = fs.readFileSync("src/lib/local-security.ts", "utf8");
const launcher = fs.readFileSync("scripts/portable-launcher.cjs", "utf8");

test("the runtime keeps bounded zip-extraction guards and redaction", () => {
  for (const marker of ["yauzl", "isSymlink", "maxEntries", "maxExpandedBytes", "validateEntrySizes", "redactLogSecrets"]) {
    assert.ok(runtime.includes(marker), marker);
  }
  assert.ok(!runtime.includes("from \"adm-zip\""));
});

test("provider tooling stays pinned to managed paths and runtimes", () => {
  for (const marker of ["dragonwilds", "hytale"]) {
    assert.ok(games.includes(marker), marker);
  }
  for (const marker of ["SERVERHUB_STEAMCMD_PATH", "SERVERHUB_HYTALE_DOWNLOADER_PATH", "Java 25", "HytaleServer.jar", "Assets.zip"]) {
    assert.ok(runtime.includes(marker), marker);
  }
});

test("the local API boundary stays restricted to loopback origins", () => {
  for (const marker of ["localhost", "127.0.0.1", "::1", "origin.port === host.port"]) {
    assert.ok(localSecurity.includes(marker), marker);
  }
});

test("the desktop session proxy enforces the issued session token", () => {
  for (const marker of ["trustedLocalBoundary", "SERVERHUB_SESSION_TOKEN", "Invalid desktop session"]) {
    assert.ok(proxy.includes(marker), marker);
  }
});

test("the native shell embeds WebView2 with no browser or console fallback", () => {
  assert.ok(launcher.includes("@webviewjs/webview"));
  assert.ok(!/(explorer\.exe|--app=|msedge|chrome\.exe)/i.test(launcher));
  assert.ok(launcher.includes("serverhub:shutdown"));
  console.log("PROVIDER_SECURITY_EXTRACTION_NATIVE_INVARIANTS_OK");
});
