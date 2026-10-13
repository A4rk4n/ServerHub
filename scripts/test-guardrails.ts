// Unit suite for resource guardrails: config normalization, sustained-
// breach evaluation (spikes never fire, incomplete windows never fire),
// the hysteresis/cooldown alert state machine, persistence, and wiring.

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_GUARDRAIL_CONFIG,
  GUARDRAIL_COOLDOWN_MS,
  MAX_SUSTAIN_MIN,
  evaluateGuardrail,
  guardrailsFile,
  loadGuardrails,
  nextGuardrailState,
  normalizeGuardrailConfig,
  saveGuardrails,
} from "../src/lib/guardrails";

const ring = (count: number, cpu: number, ram: number, now: number, stepMs = 2000) =>
  Array.from({ length: count }, (_, i) => ({ t: now - (count - 1 - i) * stepMs, cpu, ram }));

test("configs normalize with clamps and safe defaults", () => {
  assert.deepEqual(normalizeGuardrailConfig(undefined), DEFAULT_GUARDRAIL_CONFIG);
  assert.deepEqual(normalizeGuardrailConfig("garbage"), DEFAULT_GUARDRAIL_CONFIG);
  const cfg = normalizeGuardrailConfig({ enabled: true, cpuPct: 250, ramMb: 1, sustainMin: 99, action: "restart" });
  assert.deepEqual(cfg, { enabled: true, cpuPct: 100, ramMb: 256, sustainMin: MAX_SUSTAIN_MIN, action: "restart" });
  assert.equal(normalizeGuardrailConfig({ action: "explode" }).action, "notify");
  assert.equal(DEFAULT_GUARDRAIL_CONFIG.enabled, false, "guardrails are off by default");
});

test("only a fully sustained breach fires; spikes and thin windows never do", () => {
  const now = Date.now();
  const cfg = normalizeGuardrailConfig({ enabled: true, cpuPct: 90, sustainMin: 1 });
  const sustained = evaluateGuardrail(ring(35, 95, 1000, now), cfg, now);
  assert.equal(sustained?.metric, "cpu");
  assert.equal(sustained?.threshold, 90);
  const spiky = ring(35, 95, 1000, now);
  spiky[20] = { ...spiky[20], cpu: 40 }; // one dip inside the window
  assert.equal(evaluateGuardrail(spiky, cfg, now), null, "a single sample below threshold clears the breach");
  assert.equal(evaluateGuardrail(ring(5, 99, 1000, now), cfg, now), null, "a thin window (fresh start) cannot alert");
  const ramCfg = normalizeGuardrailConfig({ enabled: true, ramMb: 4096, sustainMin: 1 });
  assert.equal(evaluateGuardrail(ring(35, 10, 5000, now), ramCfg, now)?.metric, "ram");
  assert.equal(evaluateGuardrail(ring(35, 99, 9999, now), { ...cfg, enabled: false }, now), null, "disabled never evaluates");
  assert.equal(evaluateGuardrail(ring(35, 99, 9999, now), normalizeGuardrailConfig({ enabled: true }), now), null, "no thresholds, no breach");
});

test("the alert state machine fires once, re-fires after cooldown, resets on recovery", () => {
  const t0 = 1_800_000_000_000;
  const first = nextGuardrailState(undefined, true, t0);
  assert.deepEqual(first, { active: true, lastFiredAt: t0, fire: true });
  const suppressed = nextGuardrailState(first, true, t0 + 60_000);
  assert.equal(suppressed.fire, false, "a persisting breach stays silent inside the cooldown");
  const refire = nextGuardrailState(suppressed, true, t0 + GUARDRAIL_COOLDOWN_MS);
  assert.equal(refire.fire, true, "a long-sustained breach re-alerts after the cooldown");
  const recovered = nextGuardrailState(refire, false, t0 + GUARDRAIL_COOLDOWN_MS + 1000);
  assert.equal(recovered.active, false);
  const again = nextGuardrailState(recovered, true, t0 + GUARDRAIL_COOLDOWN_MS + 2000);
  assert.equal(again.fire, true, "a fresh breach after recovery fires immediately");
});

test("configs persist per server and corrupt files degrade to empty", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hub-guardrails-"));
  await saveGuardrails({ "7": normalizeGuardrailConfig({ enabled: true, ramMb: 7000 }) }, base);
  const loaded = await loadGuardrails(base);
  assert.equal(loaded["7"].ramMb, 7000);
  assert.equal(loaded["7"].enabled, true);
  await fsp.writeFile(guardrailsFile(base), "not json", "utf8");
  assert.deepEqual(await loadGuardrails(base), {});
  await fsp.rm(base, { recursive: true, force: true });
});

test("the sampler, API, notifications, and UI are wired", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("void checkGuardrails(entry)"), "every sample feeds the guardrail check without awaiting");
  assert.ok(runtime.includes("nextGuardrailState"), "hysteresis is applied in the runtime");
  assert.ok(runtime.includes('kind: "guardrail"'), "breaches notify through the webhook pipeline");
  assert.ok(runtime.includes("guardrailStates.delete"), "state clears when the process exits");
  const notifications = fs.readFileSync("src/lib/notifications.ts", "utf8");
  assert.ok(notifications.includes('"guardrail"'), "the guardrail notification kind exists");
  const route = fs.readFileSync("src/app/api/servers/[id]/guardrails/route.ts", "utf8");
  assert.ok(route.includes("normalizeGuardrailConfig"), "the API clamps configs");
  assert.ok(route.includes("Enable at least one threshold"), "an enabled guardrail needs a threshold");
  const diagnostics = fs.readFileSync("src/components/diagnostics-manager.tsx", "utf8");
  assert.ok(diagnostics.includes("Resource guardrails"), "Diagnostics hosts the configuration panel");
  const card = fs.readFileSync("src/components/server-card.tsx", "utf8");
  assert.ok(card.includes("guardrail"), "the server card shows the warning chip");
  console.log("GUARDRAILS_SUITE_OK");
});
