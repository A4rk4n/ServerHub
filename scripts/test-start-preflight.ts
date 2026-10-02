import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluateBindAddress,
  evaluateDiskFloor,
  evaluateEula,
  evaluateFleetPortConflict,
  evaluateLaunchTarget,
  evaluateMemoryBudget,
  evaluatePortProbe,
  probeLaunchTarget,
  summarizePreflight,
  type PreflightCheck,
} from "../src/lib/start-preflight";

test("preflight: fleet port conflicts distinguish active and parked neighbors", () => {
  const me = { id: 1, port: 25565 };
  const neighbors = [
    { id: 1, name: "Self", port: 25565, status: "offline" },
    { id: 2, name: "Lobby", port: 25566, status: "online" },
  ];
  // Self and different ports never conflict.
  assert.equal(evaluateFleetPortConflict(me, neighbors).severity, "ok");
  // An active neighbor on the same port blocks the start.
  for (const status of ["online", "starting", "stopping"]) {
    const check = evaluateFleetPortConflict(me, [...neighbors, { id: 3, name: "Events", port: 25565, status }]);
    assert.equal(check.severity, "blocker");
    assert.match(check.detail, /Events/);
    assert.match(check.detail, /25565/);
  }
  // A parked neighbor on the same port is only a warning.
  const parked = evaluateFleetPortConflict(me, [...neighbors, { id: 3, name: "Events", port: 25565, status: "offline" }]);
  assert.equal(parked.severity, "warning");
  assert.match(parked.detail, /Events/);
  // Live bind probe: in use → blocker, free → ok, skipped (already running) → ok.
  assert.equal(evaluatePortProbe(25565, "TCP", "127.0.0.1", false).severity, "blocker");
  assert.equal(evaluatePortProbe(25565, "TCP", "127.0.0.1", true).severity, "ok");
  assert.equal(evaluatePortProbe(25565, "UDP", "127.0.0.1", null).severity, "ok");
});

test("preflight: launch target probe and evaluation", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-"));
  try {
    const runnable = path.join(dir, "run.sh");
    const plain = path.join(dir, "notes.txt");
    fs.writeFileSync(runnable, "#!/bin/sh\n", { mode: 0o755 });
    fs.writeFileSync(plain, "hello", { mode: 0o644 });
    // Absolute paths are inspected on disk. Windows has no executable bit,
    // so an existing target always counts as runnable there.
    assert.deepEqual(await probeLaunchTarget(runnable), { exists: true, executable: true });
    assert.deepEqual(await probeLaunchTarget(plain), { exists: true, executable: process.platform === "win32" });
    assert.deepEqual(await probeLaunchTarget(path.join(dir, "missing.sh")), { exists: false, executable: false });
    // Relative commands resolve via PATH at spawn time — not probed.
    assert.equal(await probeLaunchTarget("java"), null);
    assert.equal(await probeLaunchTarget("   "), null);
    // Evaluation: manual servers need a command; absolute targets must exist and be executable.
    assert.equal(evaluateLaunchTarget("", true, null).severity, "blocker");
    assert.equal(evaluateLaunchTarget("", false, null).severity, "ok");
    assert.equal(evaluateLaunchTarget("java", true, null).severity, "ok");
    assert.equal(evaluateLaunchTarget(runnable, true, { exists: true, executable: true }).severity, "ok");
    const missing = evaluateLaunchTarget(path.join(dir, "missing.sh"), true, { exists: false, executable: false });
    assert.equal(missing.severity, "blocker");
    assert.match(missing.detail, /does not exist/);
    const notExec = evaluateLaunchTarget(plain, true, { exists: true, executable: false });
    assert.equal(notExec.severity, "blocker");
    assert.match(notExec.detail, /not executable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("preflight: disk floor and memory budget stay advisory", () => {
  // Below the alert floor is a warning, never a blocker.
  const low = evaluateDiskFloor(512, 2048);
  assert.equal(low.severity, "warning");
  assert.match(low.detail, /512 MB/);
  assert.equal(evaluateDiskFloor(4096, 2048).severity, "ok");
  // Unmeasurable volumes degrade to ok instead of blocking the start.
  assert.equal(evaluateDiskFloor(null, 2048).severity, "ok");
  assert.equal(evaluateDiskFloor(Number.NaN, 2048).severity, "ok");
  // Memory budget above the currently free RAM warns; below passes.
  const tight = evaluateMemoryBudget(8192, 1024);
  assert.equal(tight.severity, "warning");
  assert.match(tight.detail, /8\.0 GB/);
  assert.equal(evaluateMemoryBudget(1024, 8192).severity, "ok");
  assert.equal(evaluateMemoryBudget(4096, null).severity, "ok");
});

test("preflight: bind address and EULA gates", () => {
  const interfaces = {
    eth0: [{ address: "192.168.1.210", netmask: "255.255.255.0", family: "IPv4", mac: "0:0:0:0:0:0", internal: false, cidr: "192.168.1.210/24" }],
  } as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  assert.equal(evaluateBindAddress("192.168.1.210", interfaces).severity, "ok");
  assert.equal(evaluateBindAddress("0.0.0.0", interfaces).severity, "ok");
  assert.equal(evaluateBindAddress("127.0.0.1", interfaces).severity, "ok");
  const foreign = evaluateBindAddress("203.0.113.9", interfaces);
  assert.equal(foreign.severity, "blocker");
  assert.match(foreign.detail, /203\.0\.113\.9/);
  // Minecraft family requires the EULA; other games never gate on it.
  assert.equal(evaluateEula("minecraft", false).severity, "blocker");
  assert.equal(evaluateEula("minecraft-modded", false).severity, "blocker");
  assert.equal(evaluateEula("minecraft", true).severity, "ok");
  assert.equal(evaluateEula("custom", false).severity, "ok");
});

test("preflight: summary wiring and pinned runtime/route integration", () => {
  const checks: PreflightCheck[] = [
    { id: "a", label: "A", severity: "ok", detail: "fine" },
    { id: "b", label: "B", severity: "warning", detail: "heads up" },
    { id: "c", label: "C", severity: "blocker", detail: "nope" },
  ];
  const summary = summarizePreflight(checks);
  assert.equal(summary.canStart, false);
  assert.deepEqual(summary.blockers, ["nope"]);
  assert.deepEqual(summary.warnings, ["heads up"]);
  assert.equal(summarizePreflight(checks.slice(0, 2)).canStart, true);
  assert.equal(summarizePreflight([]).canStart, true);

  // Pinned wiring: the runtime consults the preflight before every start and
  // reports blockers with a stable reason prefix; the API route exposes it.
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("const preflight = await runStartPreflight(server);"));
  assert.ok(runtime.includes("return { ok: false, reason: `Pre-launch checks failed: ${preflight.blockers.join(\" \")}` };"));
  assert.ok(runtime.includes("start blocked by pre-launch checks"));
  const route = fs.readFileSync("src/app/api/servers/[id]/preflight/route.ts", "utf8");
  assert.ok(route.includes("runStartPreflight"));
  assert.ok(route.includes("checkedAt"));
});

console.log("START_PREFLIGHT_SUITE_OK");
