import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
const launcher = fs.readFileSync("scripts/portable-launcher.cjs", "utf8");
const shutdown = runtime.slice(runtime.indexOf("  const shutdown = () =>"), runtime.indexOf("  process.once(\"SIGTERM\""));
const nativeShutdown = launcher.slice(launcher.indexOf("function shutdown()"), launcher.indexOf("\n}\n\n(async", launcher.indexOf("function shutdown()")));

test("the management service shutdown drains installs, servers, and timers", () => {
  for (const marker of ["state.closing = true", "state.restartTimers.values()", "clearTimeout(timer)", "state.restartTimers.clear()", "install.controller.abort", "entry.stopping = true", "stopCommand(entry.server)", "killProcessTree(entry.child.pid, true)", "process.exit(0)"]) {
    assert.ok(shutdown.includes(marker), marker);
  }
});

test("installation cleanup and stop commands run before force kills", () => {
  assert.ok(shutdown.indexOf("install.controller.abort") < shutdown.indexOf("killProcessTree"));
  assert.ok(shutdown.indexOf("stopCommand(entry.server)") < shutdown.indexOf("killProcessTree"));
});

test("every termination signal routes through the graceful shutdown", () => {
  for (const signal of ["SIGTERM", "SIGINT", "serverhub:shutdown"]) {
    assert.ok(runtime.includes(`process.once("${signal}", shutdown)`), signal);
  }
  assert.ok(runtime.includes("Installation paused while Server Hub shuts down"));
});

test("the native shell shutdown is idempotent and bounded", () => {
  assert.ok(nativeShutdown.includes("if (shuttingDown) return"));
  assert.ok(nativeShutdown.includes("process.emit(\"serverhub:shutdown\")"));
  assert.ok(nativeShutdown.includes("setTimeout(() => process.exit(0), 2_500)"));
  assert.ok(nativeShutdown.indexOf("process.emit(\"serverhub:shutdown\")") < nativeShutdown.indexOf("setTimeout"));
  console.log("GRACEFUL_NATIVE_SHUTDOWN_INVARIANTS_OK");
});
