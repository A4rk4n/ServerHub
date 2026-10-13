// Mod copy between servers (addon-copy.ts): planning dedupe rules,
// pair validation, and the route/UI wiring pins.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { planAddonCopy, validateCopyPair } from "../src/lib/addon-copy";

const addon = (over: Partial<{ id: number; name: string; projectId: string; filePath: string; enabled: boolean }>) => ({
  id: 1,
  name: "Lithium",
  projectId: "gvQqBUqZ",
  filePath: "mods/lithium.jar",
  enabled: true,
  ...over,
});

test("plan copies new mods and skips duplicates by project and by file name", () => {
  const source = [
    addon({ id: 1, name: "Lithium", projectId: "gvQqBUqZ", filePath: "mods/lithium.jar" }),
    addon({ id: 2, name: "Sodium", projectId: "AANobbMI", filePath: "mods/sodium.jar" }),
    addon({ id: 3, name: "Hand jar", projectId: "", filePath: "mods/hand.jar" }),
    addon({ id: 4, name: "Ghost row", projectId: "", filePath: "" }),
  ];
  const target = [
    addon({ id: 9, name: "Lithium", projectId: "gvQqBUqZ", filePath: "mods/lithium-old.jar" }),
    addon({ id: 10, name: "Hand jar", projectId: "", filePath: "mods/hand.jar" }),
  ];
  const plan = planAddonCopy(source, target);
  assert.deepEqual(plan.copy.map((a) => a.name), ["Sodium"]);
  assert.deepEqual(plan.skipped, [
    { name: "Lithium", reason: "already installed" },
    { name: "Hand jar", reason: "a file with this name already exists" },
    { name: "Ghost row", reason: "no file tracked" },
  ]);
});

test("disabled mods still dedupe: .disabled on either side matches the same file", () => {
  const source = [addon({ filePath: "mods/lithium.jar.disabled", enabled: false, projectId: "" })];
  const target = [addon({ filePath: "mods/lithium.jar", projectId: "" })];
  assert.equal(planAddonCopy(source, target).copy.length, 0, "a disabled copy of an installed file is a duplicate");
  // ...and a disabled mod with no counterpart copies with its state intact.
  const fresh = planAddonCopy(source, []);
  assert.equal(fresh.copy.length, 1);
  assert.equal(fresh.copy[0].enabled, false);
});

test("pair validation: same server, non-Fabric, and version mismatches are refused", () => {
  const fabric = (id: number, version = "1.21.1") => ({ id, gameId: "minecraft-modded", loader: "fabric", version });
  assert.equal(validateCopyPair(fabric(1), fabric(2)), null);
  assert.match(validateCopyPair(fabric(1), fabric(1)) ?? "", /same server/);
  assert.match(validateCopyPair(fabric(1), { id: 2, gameId: "minecraft", loader: "", version: "1.21.1" }) ?? "", /Fabric/);
  assert.match(validateCopyPair(fabric(1), fabric(2, "1.20.4")) ?? "", /1\.21\.1 vs 1\.20\.4/);
});

test("wiring pins: route and manager UI", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/addons/copy/route.ts", "utf8");
  assert.ok(route.includes("validateCopyPair") && route.includes("planAddonCopy"), "route uses the planner");
  assert.ok(route.includes('`${to}.copying`'), "files land via copy-then-rename");
  const ui = fs.readFileSync("src/components/addons-manager.tsx", "utf8");
  assert.ok(ui.includes("Copy from…") && ui.includes("addons/copy"), "manager exposes the copy flow");
  console.log("ADDON_COPY_SUITE_OK");
});
