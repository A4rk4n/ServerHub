import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CLONE_EXCLUDED,
  CONFIG_ONLY_EXCLUDED,
  canCopyFiles,
  cloneWorldName,
  pickClonePort,
  resolveCloneName,
} from "../src/lib/server-clone";

test("clone: port picking scans upward and validates explicit requests", () => {
  // Auto: first free port above the source's.
  assert.deepEqual(pickClonePort(25565, [25565, 25566]), { ok: true, port: 25567 });
  assert.deepEqual(pickClonePort(25565, [25565]), { ok: true, port: 25566 });
  // Explicit: honored when free…
  assert.deepEqual(pickClonePort(25565, [25565], 30000), { ok: true, port: 30000 });
  // …409 when configured on any server, 400 when nonsense.
  assert.deepEqual(pickClonePort(25565, [25565, 30000], 30000), { ok: false, status: 409, error: "Port 30000 is already configured on another server" });
  for (const junk of [80, 70000, 1.5, "30000", true]) {
    const choice = pickClonePort(25565, [], junk);
    assert.equal(choice.ok, false);
    assert.equal((choice as { status: number }).status, 400, `rejects ${String(junk)}`);
  }
  // Exhaustion at the top of the range.
  assert.equal(pickClonePort(65535, [65535]).ok, false);
});

test("clone: name resolution defaults when omitted but rejects explicit blanks", () => {
  assert.deepEqual(resolveCloneName(undefined, "Lobby"), { ok: true, name: "Lobby Copy" });
  assert.deepEqual(resolveCloneName("  Events Mirror  ", "Lobby"), { ok: true, name: "Events Mirror" });
  assert.equal((resolveCloneName("x".repeat(100), "Lobby") as { name: string }).name.length, 60);
  for (const bad of ["", "   ", 42, {}]) assert.equal(resolveCloneName(bad, "Lobby").ok, false);
});

test("clone: file copies only run against a server that cannot be writing", () => {
  for (const safe of ["offline", "crashed", "error"]) assert.equal(canCopyFiles(safe), true, safe);
  for (const busy of ["online", "starting", "stopping", "installing", "updating"]) assert.equal(canCopyFiles(busy), false, busy);
});

test("clone: world naming keeps the copied world and renames the fresh one", () => {
  assert.equal(cloneWorldName("MyWorld", true), "MyWorld", "a file clone must load the copied world directory");
  assert.equal(cloneWorldName("MyWorld", false), "MyWorld-clone", "a config clone generates a fresh world");
  // Exclusion contracts stay explicit.
  assert.deepEqual([...CLONE_EXCLUDED], ["credentials", "backups", "players", "logs", "tasks", "schedules"]);
  assert.deepEqual([...CONFIG_ONLY_EXCLUDED], ["world data", "mods", "server files"]);
});

test("clone: pinned route, runtime, and UI wiring", () => {
  const route = fs.readFileSync("src/app/api/servers/[id]/clone/route.ts", "utf8");
  assert.ok(route.includes('{ error: "Invalid JSON body" }'), "malformed POST bodies 400");
  assert.ok(route.includes("canCopyFiles(source.status)"), "live sources refuse file clones");
  assert.ok(route.includes('status: withFiles ? "offline" : "error"'), "file clones are ready to start; config clones reinstall");
  assert.ok(route.includes("cloneWorldName(source.worldName, withFiles)"));
  assert.ok(route.includes("await db.delete(servers).where(eq(servers.id, clone.id));"), "a failed copy removes the half-clone");
  assert.ok(route.includes('launchCommand: source.launchCommand'), "custom servers stay startable after cloning");
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("export async function cloneServerFiles"), "the runtime owns the directory copy");
  const ui = fs.readFileSync("src/components/settings-manager.tsx", "utf8");
  assert.ok(ui.includes("Copy server files too"), "settings offers the file-copy toggle");
  assert.ok(ui.includes("copyFiles:cloneWithFiles"), "the toggle reaches the API");
});

console.log("SERVER_CLONE_SUITE_OK");
