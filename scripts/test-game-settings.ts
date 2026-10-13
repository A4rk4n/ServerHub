// Gameplay settings (game-settings.ts): curated catalog sanity, parse +
// coerce behaviour, validation rejects, merge preservation, and the
// route/page wiring pins.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  coerceGameSetting,
  GAME_SETTING_FIELDS,
  PANEL_OWNED_KEYS,
  parseGameSettings,
  validateGameSettings,
} from "../src/lib/game-settings";
import { propertiesText } from "../src/lib/runtime";

test("catalog never overlaps panel-owned keys and stays well-formed", () => {
  const owned = new Set<string>(PANEL_OWNED_KEYS);
  for (const field of GAME_SETTING_FIELDS) {
    assert.ok(!owned.has(field.key), `${field.key} is panel-owned — two writers would fight over it`);
    assert.ok(field.label && field.hint, `${field.key} needs a label and hint`);
    if (field.type === "integer") assert.ok(field.min <= (field.fallback as number) && (field.fallback as number) <= field.max);
    if (field.type === "enum") assert.ok(field.options.includes(field.fallback as string));
  }
  assert.ok(GAME_SETTING_FIELDS.length >= 10, "a useful spread of settings");
});

test("parse reads curated keys only; coerce falls back on absent or mangled values", () => {
  const raw = parseGameSettings("# comment\ngamemode=creative\nview-distance=12\nmotd=Hi there\nhardcore=banana\n");
  assert.deepEqual(raw, { gamemode: "creative", "view-distance": "12", hardcore: "banana" });
  const byKey = new Map(GAME_SETTING_FIELDS.map((f) => [f.key, f]));
  assert.equal(coerceGameSetting(byKey.get("gamemode")!, raw.gamemode), "creative");
  assert.equal(coerceGameSetting(byKey.get("view-distance")!, raw["view-distance"]), 12);
  assert.equal(coerceGameSetting(byKey.get("hardcore")!, raw.hardcore), false, "mangled boolean falls back");
  assert.equal(coerceGameSetting(byKey.get("simulation-distance")!, undefined), 8, "absent key falls back");
  assert.deepEqual(parseGameSettings(null), {});
});

test("validation: good set passes, bad values and foreign keys are refused with reasons", () => {
  const good = validateGameSettings({ gamemode: "adventure", hardcore: true, "view-distance": 16 });
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.values, { gamemode: "adventure", hardcore: true, "view-distance": 16 });

  const bad = validateGameSettings({
    gamemode: "peaceful",
    "view-distance": 99,
    hardcore: "yes",
    motd: "sneaky",
    "max-tick-time": 0,
  });
  assert.deepEqual(bad.values, {});
  assert.equal(bad.problems.length, 5);
  assert.ok(bad.problems.some((p) => p.includes("survival, creative")));
  assert.ok(bad.problems.some((p) => p.includes("between 3 and 32")));
  assert.ok(bad.problems.some((p) => p.includes("true or false")));
  assert.ok(bad.problems.some((p) => p.includes("managed from the server settings form")), "panel-owned keys get a pointer, not a shrug");
  assert.ok(bad.problems.some((p) => p.includes("Unknown setting")));
});

test("merge preserves comments, unknown keys and order; updates in place", () => {
  const existing = "# Minecraft server properties\nmotd=Keep me\nview-distance=10\nsome-mod-key=7\n";
  const merged = propertiesText(existing, { "view-distance": 16, gamemode: "creative" });
  const lines = merged.trimEnd().split("\n");
  assert.equal(lines[0], "# Minecraft server properties");
  assert.equal(lines[1], "motd=Keep me");
  assert.equal(lines[2], "view-distance=16", "existing key updated in place");
  assert.equal(lines[3], "some-mod-key=7", "unknown keys untouched");
  assert.equal(lines[lines.length - 1], "gamemode=creative", "new keys appended at the end");
});

test("wiring pins: route and settings page", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/game-settings/route.ts", "utf8");
  assert.ok(route.includes("validateGameSettings") && route.includes("propertiesText"), "route validates then merges");
  assert.ok(route.includes("writeServerFile"), "writes go through filesys (safety copies included)");
  const page = fs.readFileSync("src/app/servers/[id]/settings/page.tsx", "utf8");
  assert.ok(page.includes("GameSettingsPanel"), "panel mounted on the settings page");
  console.log("GAME_SETTINGS_SUITE_OK");
});
