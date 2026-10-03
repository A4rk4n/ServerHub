import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PANEL_SETTINGS_KIND,
  PANEL_SETTINGS_VERSION,
  SECTION_FILES,
  buildPanelSettingsBundle,
  panelSettingsFileName,
  readPanelSettings,
  verifyPanelSettingsBundle,
  writePanelSettings,
} from "../src/lib/panel-settings";

test("panel settings: the whitelist is configuration, never state or secrets", () => {
  const files = Object.values(SECTION_FILES) as string[];
  assert.ok(!files.includes("pin-lock.json"), "the PIN lock must never travel in a bundle");
  assert.ok(!files.includes("maintenance.json"), "maintenance is a transient flag, not a setting");
  assert.ok(files.every((file) => !file.endsWith("-state.json")), "runtime state files are excluded");
  assert.equal(files.length, 8);
});

test("panel settings: build + verify round-trip", () => {
  const bundle = buildPanelSettingsBundle({ diskAlerts: { enabled: true, minFreeMb: 4096 } }, "2.52.0", new Date(Date.UTC(2026, 9, 2, 10, 0, 0)));
  assert.equal(bundle.kind, PANEL_SETTINGS_KIND);
  assert.equal(bundle.version, PANEL_SETTINGS_VERSION);
  assert.equal(bundle.exportedAt, "2026-10-02T10:00:00.000Z");
  const verdict = verifyPanelSettingsBundle(JSON.parse(JSON.stringify(bundle)));
  assert.ok(verdict.ok);
  if (verdict.ok) assert.deepEqual(verdict.bundle.settings.diskAlerts, { enabled: true, minFreeMb: 4096 });
});

test("panel settings: verification rejects junk", () => {
  assert.equal(verifyPanelSettingsBundle(null).ok, false);
  assert.equal(verifyPanelSettingsBundle([]).ok, false);
  assert.equal(verifyPanelSettingsBundle({ kind: "something-else", version: 1, settings: {} }).ok, false);
  assert.equal(verifyPanelSettingsBundle({ kind: PANEL_SETTINGS_KIND, version: 99, settings: {} }).ok, false);
  assert.equal(verifyPanelSettingsBundle({ kind: PANEL_SETTINGS_KIND, version: 1 }).ok, false);
  const badSection = verifyPanelSettingsBundle({ kind: PANEL_SETTINGS_KIND, version: 1, settings: { diskAlerts: ["not", "an", "object"] } });
  assert.equal(badSection.ok, false);
  // unknown sections are ignored, not fatal
  const extra = verifyPanelSettingsBundle({ kind: PANEL_SETTINGS_KIND, version: 1, settings: { mystery: { a: 1 } } });
  assert.ok(extra.ok);
  if (extra.ok) assert.deepEqual(extra.bundle.settings, {});
});

test("panel settings: filesystem round-trip", async () => {
  const src = await fs.promises.mkdtemp(path.join(os.tmpdir(), "psrc-"));
  const dst = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pdst-"));
  await fs.promises.writeFile(path.join(src, "disk-alerts.json"), JSON.stringify({ enabled: true, minFreeMb: 4096, cooldownMin: 60 }), "utf8");
  await fs.promises.writeFile(path.join(src, "server-tags.json"), JSON.stringify({ "1": ["production"] }), "utf8");
  await fs.promises.writeFile(path.join(src, "notifications.json"), "{corrupt", "utf8"); // must degrade, not throw
  const settings = await readPanelSettings(src);
  assert.deepEqual(settings.diskAlerts, { enabled: true, minFreeMb: 4096, cooldownMin: 60 });
  assert.deepEqual(settings.serverTags, { "1": ["production"] });
  assert.equal(settings.notifications, null, "corrupt files export as absent");
  assert.equal(settings.logRetention, null, "missing files export as absent");

  const applied = await writePanelSettings(settings, dst);
  assert.deepEqual(applied.sort(), ["diskAlerts", "serverTags"]);
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(dst, "disk-alerts.json"), "utf8")), { enabled: true, minFreeMb: 4096, cooldownMin: 60 });
  assert.ok(!fs.existsSync(path.join(dst, "notifications.json")), "null sections are never written");
  await fs.promises.rm(src, { recursive: true, force: true });
  await fs.promises.rm(dst, { recursive: true, force: true });
});

test("panel settings: naming + API wiring", () => {
  assert.equal(panelSettingsFileName(new Date(Date.UTC(2026, 9, 2, 10, 45, 0))), "serverhub-panel-settings-20261002-104500.json");
  const route = fs.readFileSync("src/app/api/panel-settings/route.ts", "utf8");
  assert.ok(route.includes('return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })'), "malformed JSON cannot half-apply an import");
  assert.ok(route.includes("Content-Disposition"), "the export downloads as a file");
  assert.ok(route.includes("verifyPanelSettingsBundle"), "imports are verified before anything is written");
  console.log("PANEL_SETTINGS_SUITE_OK");
});
