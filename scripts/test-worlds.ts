// World manager (worlds.ts): capability + folder-name rules, delete and
// activate verdicts, and the route/page wiring pins.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { canActivateWorld, canDeleteWorld, couldBeWorldDir, isWorldCapable } from "../src/lib/worlds";

test("capability: Java editions only", () => {
  assert.ok(isWorldCapable("minecraft"));
  assert.ok(isWorldCapable("minecraft-modded"));
  assert.ok(!isWorldCapable("minecraft-bedrock"), "Bedrock keeps worlds in a nested folder — different layout, not supported");
  assert.ok(!isWorldCapable("valheim"));
  assert.ok(!isWorldCapable("custom"));
});

test("world folder names: infrastructure dirs, dotfiles and traversal are never worlds", () => {
  assert.ok(couldBeWorldDir("world"));
  assert.ok(couldBeWorldDir("creative_flat"));
  assert.ok(!couldBeWorldDir("mods"));
  assert.ok(!couldBeWorldDir("logs"));
  assert.ok(!couldBeWorldDir(".fabric"));
  assert.ok(!couldBeWorldDir(".."));
  assert.ok(!couldBeWorldDir("a/b"));
  assert.ok(!couldBeWorldDir("a\\b"));
  assert.ok(!couldBeWorldDir(""));
});

test("delete verdicts: active world and running server are protected", () => {
  assert.match(canDeleteWorld("world", "world", "offline") ?? "", /active world/);
  assert.match(canDeleteWorld("old", "world", "online") ?? "", /Stop the server/);
  assert.match(canDeleteWorld("old", "world", "starting") ?? "", /Stop the server/);
  assert.equal(canDeleteWorld("old", "world", "offline"), null);
  assert.equal(canDeleteWorld("old", "world", "crashed"), null, "a crashed server holds no lock");
});

test("activate verdicts", () => {
  assert.equal(canActivateWorld("new_world", "world"), null);
  assert.match(canActivateWorld("world", "world") ?? "", /already active/);
  assert.match(canActivateWorld("a/b", "world") ?? "", /valid world folder/);
  assert.match(canActivateWorld("x".repeat(41), "world") ?? "", /40 characters/);
});

test("wiring pins: route guards + settings page mount", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/worlds/route.ts", "utf8");
  assert.ok(route.includes("level.dat"), "a world is a directory with level.dat");
  assert.ok(route.includes("canDeleteWorld"), "delete goes through the verdict");
  assert.ok(route.includes("safePath"), "deletion is traversal-safe");
  const page = fs.readFileSync("src/app/servers/[id]/settings/page.tsx", "utf8");
  assert.ok(page.includes("WorldsPanel"), "panel mounted on the settings page");
  console.log("WORLDS_SUITE_OK");
});
