// Unit suite for the crash analyzer: the heuristic rule matrix, rule
// precedence and newest-first evidence, signal-only and unknown
// fallbacks, the scan cap, and the handleExit wiring that turns a
// diagnosis into an incident and an enriched crash notification.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { CRASH_RULE_CAUSES, analyzeCrash } from "../src/lib/crash-analyzer";

const ctx = { exitCode: 1, signal: null as string | null };

test("every rule in the matrix diagnoses its representative log line", () => {
  const samples: Record<string, string> = {
    eula: "[Server] You need to agree to the EULA in order to run the server.",
    "out-of-memory": "java.lang.OutOfMemoryError: Java heap space",
    "port-in-use": "io.netty.channel.unix.Errors$NativeIoException: bind(..) failed: Address already in use",
    "wrong-java": "java.lang.UnsupportedClassVersionError: net/minecraft/server/Main has been compiled by a more recent version (class file version 69.0)",
    "corrupted-world": "net.minecraft.world.level.chunk.storage.RegionFile: Exception reading r.0.0.mca",
    "mod-conflict": "org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: Mixin apply for mod xyz failed",
    "missing-file": "Error: Unable to access jarfile server.jar",
    "disk-full": "java.io.IOException: No space left on device",
  };
  assert.deepEqual(Object.keys(samples).sort(), [...CRASH_RULE_CAUSES].sort(), "the sample matrix covers every rule");
  for (const [cause, line] of Object.entries(samples)) {
    const diagnosis = analyzeCrash(["[12:00:00] Server starting...", line, "[12:00:01] Process exited"], ctx);
    assert.equal(diagnosis.cause, cause, `${cause} line diagnoses correctly`);
    assert.ok(diagnosis.fix.length > 20, `${cause} comes with a concrete fix`);
    assert.ok(diagnosis.detail.includes(line.trim().slice(0, 60)), `${cause} quotes its evidence`);
  }
});

test("rule order decides precedence and evidence is matched newest-first", () => {
  const both = analyzeCrash(["java.lang.OutOfMemoryError: heap", "You need to agree to the EULA"], ctx);
  assert.equal(both.cause, "eula", "the more specific rule (listed first) wins regardless of line order");
  const twice = analyzeCrash(["Address already in use: old attempt", "restarting...", "Address already in use: newest attempt"], ctx);
  assert.ok(twice.matchedLine.includes("newest attempt"), "the newest matching line is the quoted evidence");
});

test("signal-only and unknown crashes still produce useful diagnoses", () => {
  const killed = analyzeCrash(["normal log line"], { exitCode: null, signal: "SIGKILL" });
  assert.equal(killed.cause, "killed");
  assert.ok(killed.fix.includes("memory"), "SIGKILL points at the OOM killer");
  const unknown = analyzeCrash(["normal log line"], { exitCode: 137, signal: null });
  assert.equal(unknown.cause, "unknown");
  assert.ok(unknown.title.includes("137"), "the exit code is preserved in the title");
  assert.ok(unknown.fix.includes("Console"), "the generic fix points at the console tail");
});

test("the scan is capped to the last 120 lines and context enriches fixes", () => {
  const old = ["java.lang.OutOfMemoryError: ancient history", ...Array.from({ length: 125 }, (_, i) => `noise ${i}`)];
  assert.equal(analyzeCrash(old, ctx).cause, "unknown", "evidence older than the cap is ignored");
  const sized = analyzeCrash(["java.lang.OutOfMemoryError: heap"], { ...ctx, memoryMb: 4096 });
  assert.ok(sized.fix.includes("4096"), "the current memory limit appears in the OOM fix");
});

test("a crash diagnosis becomes an incident and enriches the notification", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  const exit = runtime.slice(runtime.indexOf("async function handleExit"));
  assert.ok(exit.includes("analyzeCrash"), "handleExit runs the analyzer on crashes");
  assert.ok(exit.includes("consoleLogs"), "the analyzer reads the real console tail");
  assert.ok(exit.includes('diagnosis.cause === "unknown" ? "warning" : "critical"'), "diagnosed causes are critical incidents, unknown ones warnings");
  assert.ok(exit.includes("diagnosis.fix"), "the fix text lands in the incident remediation");
  assert.ok(exit.includes("crashTitle ? ` — ${crashTitle}`"), "the crash webhook carries the diagnosis title");
  assert.ok(exit.includes('"Crash analyzer"'), "the console shows the diagnosis immediately");
  console.log("CRASH_ANALYZER_SUITE_OK");
});
