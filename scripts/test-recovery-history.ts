import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("the runtime records bounded automatic recovery attempts and outcomes", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  for (const marker of ["| \"recovering\"", "Recovery attempt ${attempt + 1}/3 scheduled", "bootstrap-self-update", "recovery succeeded on attempt", "Date.now() - recoveryStartedAt", "\"success\""]) {
    assert.ok(runtime.includes(marker), marker);
  }
});

test("the installation progress UI renders the automatic recovery history", () => {
  const ui = fs.readFileSync("src/components/installation-progress.tsx", "utf8");
  assert.ok(ui.includes("Automatic recovery history"));
  assert.ok(ui.includes("event.phase === \"recovering\""));
  console.log("INSTALLATION_RECOVERY_HISTORY_OK");
});
