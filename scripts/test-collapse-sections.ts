// UI declutter (collapse-section.tsx): lazy-mount semantics and the
// grouped layout of the tools and server-settings pages — every panel
// that existed before the regrouping must still be mounted somewhere.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

test("collapse section: lazy mount, hidden (not unmounted) after first open, a11y", () => {
  const src = fs.readFileSync("src/components/collapse-section.tsx", "utf8");
  assert.ok(src.includes("everOpened &&"), "children stay unmounted until the first open — no hidden fetch storms");
  assert.ok(src.includes('!open && "hidden"'), "after first open, closing hides instead of unmounting — panel state survives");
  assert.ok(src.includes("aria-expanded"), "the toggle reports its state");
  assert.ok(src.startsWith('"use client"'), "it is a client component usable from server pages");
});

test("tools page: all twelve panels still mounted, health surfaces stay above the fold", () => {
  const page = fs.readFileSync("src/app/tools/page.tsx", "utf8");
  const panels = [
    "ToolHealthManager", "SelfCheckPanel", "NotificationsPanel", "DiskAlertsPanel",
    "BackupVerificationPanel", "BackupMirrorPanel", "LogRetentionPanel", "AddonUpdateSweepPanel",
    "PanelSettingsPanel", "StatusPagePanel", "PinLockPanel", "AccessLogPanel",
  ];
  for (const panel of panels) {
    assert.ok(page.includes(`<${panel} />`), `${panel} must stay mounted after the regrouping`);
  }
  assert.ok(page.indexOf("<ToolHealthManager />") < page.indexOf("<CollapseSection"), "health checks stay visible, not collapsed");
  assert.ok(page.indexOf("<SelfCheckPanel />") < page.indexOf("<CollapseSection"), "self-check stays visible, not collapsed");
  assert.equal((page.match(/<CollapseSection /g) ?? []).length, 4, "four titled groups");
});

test("settings page: every panel still mounted, gameplay group opens by default", () => {
  const page = fs.readFileSync("src/app/servers/[id]/settings/page.tsx", "utf8");
  for (const panel of ["SettingsManager", "GameSettingsPanel", "WorldsPanel", "TagsEditor", "NotesPanel", "PowerWindowsPanel", "BackupTiersPanel", "MaintenancePanel"]) {
    assert.ok(page.includes(`<${panel}`), `${panel} must stay mounted after the regrouping`);
  }
  assert.match(page, /title="Gameplay & worlds"[^>]*defaultOpen/, "the Minecraft group is open by default");
  assert.ok(page.indexOf("<SettingsManager") < page.indexOf("<CollapseSection"), "the core settings form stays visible, not collapsed");
  console.log("COLLAPSE_SECTIONS_SUITE_OK");
});
