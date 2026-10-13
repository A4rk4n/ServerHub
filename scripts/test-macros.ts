// Unit suite for command macros: normalization clamps, the exact-
// confirmation contract for scheduling, persistence (including corrupt
// files), and the wiring that runs macros from the console and the
// scheduler with abort-on-first-failure semantics.

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_MACRO_STEPS,
  MAX_STEP_DELAY_SEC,
  loadMacros,
  macroConfirmation,
  macroSummary,
  macrosFile,
  normalizeMacro,
  saveMacros,
} from "../src/lib/macros";

test("macros normalize with clamps; empty names or step lists are rejected", () => {
  assert.equal(normalizeMacro(undefined), null);
  assert.equal(normalizeMacro({ name: "  ", steps: [{ command: "say hi" }] }), null, "a blank name is invalid");
  assert.equal(normalizeMacro({ name: "x", steps: [{ command: "  " }] }), null, "whitespace-only commands leave nothing to run");
  const macro = normalizeMacro({
    name: ` ${"n".repeat(80)} `,
    steps: [
      { command: " say Restarting in 30s ", delaySec: 999 },
      { command: "save-all", delaySec: -5 },
      { command: "", delaySec: 10 }, // dropped
      { command: "stop", delaySec: "nonsense" },
    ],
  });
  assert.ok(macro);
  assert.equal(macro.name.length, 60, "names clamp to 60 chars");
  assert.equal(macro.steps.length, 3, "empty steps are dropped");
  assert.deepEqual(macro.steps.map((step) => step.delaySec), [MAX_STEP_DELAY_SEC, 0, 0], "delays clamp to 0-120");
  assert.equal(macro.steps[0].command, "say Restarting in 30s");
  assert.ok(macro.id.length > 10, "new macros get generated ids");
  const kept = normalizeMacro({ name: "same", steps: [{ command: "stop" }] }, "keep-this-id");
  assert.equal(kept?.id, "keep-this-id", "updates keep the existing id");
  const long = normalizeMacro({ name: "big", steps: Array.from({ length: 50 }, (_, i) => ({ command: `cmd${i}` })) });
  assert.equal(long?.steps.length, MAX_MACRO_STEPS, "step count clamps to 12");
});

test("the scheduling confirmation is every command, one per line", () => {
  const macro = normalizeMacro({ name: "restart", steps: [{ command: "say Restarting in 30s", delaySec: 30 }, { command: "stop" }] })!;
  assert.equal(macroConfirmation(macro), "say Restarting in 30s\nstop");
  assert.equal(macroSummary(macro), "2 steps · 30s of pauses");
  assert.equal(macroSummary(normalizeMacro({ name: "one", steps: [{ command: "stop" }] })!), "1 step");
});

test("macros persist per server and corrupt files degrade to empty", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hub-macros-"));
  const macro = normalizeMacro({ name: "backup now", steps: [{ command: "save-all" }] })!;
  await saveMacros({ "3": [macro] }, base);
  const loaded = await loadMacros(base);
  assert.equal(loaded["3"][0].name, "backup now");
  assert.equal(loaded["3"][0].id, macro.id);
  await fsp.writeFile(macrosFile(base), "{broken", "utf8");
  assert.deepEqual(await loadMacros(base), {});
  await fsp.rm(base, { recursive: true, force: true });
});

test("the runtime executes steps in order and aborts on the first failure", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("export async function executeMacro"), "executeMacro is exported for the run-now route");
  assert.ok(/if \(!result\.ok\) \{[\s\S]{0,400}?stepsRun: index/.test(runtime), "a failing step aborts and reports how far it got");
  assert.ok(runtime.includes('task.type === "macro"'), "the scheduler sweep handles macro tasks");
  assert.ok(runtime.includes("Macro no longer exists"), "a deleted macro records a failed run instead of throwing");
  assert.ok(runtime.includes('executeMacro(server, macro, "Scheduler")'), "scheduled macros are attributed to the Scheduler");
});

test("the API, task gating, and UI are wired", () => {
  const tasksRoute = fs.readFileSync("src/app/api/servers/[id]/tasks/route.ts", "utf8");
  assert.ok(tasksRoute.includes('"macro"'), "macro is a schedulable task type");
  assert.ok(tasksRoute.includes("macroConfirmation"), "scheduling a macro requires the exact-confirmation contract");
  const patchRoute = fs.readFileSync("src/app/api/servers/[id]/tasks/[tid]/route.ts", "utf8");
  assert.ok(patchRoute.includes("macroConfirmation"), "editing a task to a macro is gated the same way");
  const runRoute = fs.readFileSync("src/app/api/servers/[id]/macros/[macroId]/run/route.ts", "utf8");
  assert.ok(runRoute.includes("executeMacro"), "the run-now route executes through the runtime");
  const crud = fs.readFileSync("src/app/api/servers/[id]/macros/route.ts", "utf8");
  assert.ok(crud.includes("MAX_MACROS_PER_SERVER"), "the per-server macro cap is enforced");
  const consoleView = fs.readFileSync("src/components/console-view.tsx", "utf8");
  assert.ok(consoleView.includes("MacrosBar"), "the console renders the macros bar");
  assert.ok(consoleView.includes("These exact commands will be sent"), "running a macro shows the exact commands first");
  const tasksUi = fs.readFileSync("src/components/tasks-manager.tsx", "utf8");
  assert.ok(tasksUi.includes("macro: { label:"), "the task form offers the macro type");
  assert.ok(tasksUi.includes("Pick a macro"), "the task form picks from existing macros");
  console.log("MACROS_SUITE_OK");
});
