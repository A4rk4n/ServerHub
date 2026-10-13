import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_MAINTENANCE_STATE,
  MAX_MAINTENANCE_NOTE_LENGTH,
  normalizeMaintenanceState,
  readAllMaintenance,
  readMaintenance,
  writeMaintenance,
} from "../src/lib/maintenance";
import { publicStatusLabel } from "../src/lib/status-page";

test("maintenance: state normalization", () => {
  assert.deepEqual(normalizeMaintenanceState(undefined), DEFAULT_MAINTENANCE_STATE);
  const on = normalizeMaintenanceState({ enabled: true, note: "  upgrading mods  ", since: "2026-10-02T08:00:00.000Z" });
  assert.deepEqual(on, { enabled: true, note: "upgrading mods", since: "2026-10-02T08:00:00.000Z" });
  // enabled must be an explicit boolean true
  assert.equal(normalizeMaintenanceState({ enabled: "yes" }).enabled, false);
  assert.equal(normalizeMaintenanceState({ enabled: 1 }).enabled, false);
  // bad notes are discarded, not saved
  assert.equal(normalizeMaintenanceState({ note: "a\nb" }).note, "");
  assert.equal(normalizeMaintenanceState({ note: "x".repeat(MAX_MAINTENANCE_NOTE_LENGTH + 1) }).note, "");
  // bad `since` degrades to null
  assert.equal(normalizeMaintenanceState({ since: "not a date" }).since, null);
  assert.equal(normalizeMaintenanceState({ since: 12345 }).since, null);
});

test("maintenance: sidecar round-trip", async () => {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "maint-"));
  assert.deepEqual(await readAllMaintenance(base), {}, "missing file reads as empty");
  const saved = await writeMaintenance(4, { enabled: true, note: "world surgery", since: "2026-10-02T08:00:00.000Z" }, base);
  assert.equal(saved.enabled, true);
  assert.deepEqual(await readMaintenance(4, base), saved);
  assert.deepEqual(await readMaintenance(5, base), DEFAULT_MAINTENANCE_STATE, "unknown servers are not in maintenance");
  // disabling removes the key entirely
  await writeMaintenance(4, { enabled: false, note: "", since: null }, base);
  assert.deepEqual(await readAllMaintenance(base), {});
  // corrupt file degrades to "nobody is in maintenance", never throws
  await fs.promises.writeFile(path.join(base, "maintenance.json"), "{broken", "utf8");
  assert.deepEqual(await readAllMaintenance(base), {});
  await fs.promises.rm(base, { recursive: true, force: true });
});

test("maintenance: public status mapping", () => {
  assert.equal(publicStatusLabel("maintenance"), "maintenance");
  assert.equal(publicStatusLabel("online"), "online");
  assert.equal(publicStatusLabel("crashed"), "offline");
});

test("maintenance: runtime + API wiring", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("if (inMaintenance[String(task.serverId)]?.enabled) continue;"), "the scheduler skips maintained servers");
  assert.ok(runtime.includes('"Maintenance mode: automatic restart suppressed."'), "the crash watchdog stands down");
  assert.ok(runtime.includes("if (inMaintenance[String(serverId)]?.enabled) { announcerState.delete(serverId); continue; }"), "announcements go quiet and re-anchor afterwards");
  assert.ok(runtime.includes('inMaintenance[String(server.id)]?.enabled ? "maintenance" : server.status'), "the public status page shows maintenance");
  const route = fs.readFileSync("src/app/api/servers/[id]/maintenance/route.ts", "utf8");
  assert.ok(route.includes('return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })'), "malformed JSON cannot flip the flag");
  assert.ok(route.includes("previous.enabled ? previous.since : new Date().toISOString()"), "`since` is stamped on enable and preserved while on");
  const serversRoute = fs.readFileSync("src/app/api/servers/route.ts", "utf8");
  assert.ok(serversRoute.includes("maintenance: allMaintenance[String(server.id)]?.enabled ?? false"), "the fleet payload carries the flag");
  console.log("MAINTENANCE_SUITE_OK");
});
