import assert from "node:assert/strict";
import test from "node:test";
import { managedExecutablePids, parseManagedProcessProbe, waitForManagedExecutableExit } from "../src/lib/managed-process";

const managed = "C:\\Users\\Server\\AppData\\Roaming\\ServerHub\\tools\\steamcmd\\steamcmd.exe";

type Runner = (command: string, args: string[]) => Promise<{ stdout: string }>;

function scriptedRunner(state: { probes: number }): Runner {
  return async (command: string, args: string[]) => {
    assert.equal(command, "powershell.exe");
    assert.ok(args.join(" ").includes("Win32_Process"));
    state.probes++;
    return { stdout: state.probes < 3 ? JSON.stringify({ ProcessId: 42, ExecutablePath: managed }) : "[]" };
  };
}

test("parseManagedProcessProbe matches only the exact managed executable path", () => {
  const output = JSON.stringify([{ ProcessId: 42, ExecutablePath: managed.toUpperCase() }, { ProcessId: 43, ExecutablePath: "D:\\Other\\steamcmd.exe" }, { ProcessId: 44, ExecutablePath: null }]);
  assert.deepEqual(parseManagedProcessProbe(output, managed), [42]);
  assert.deepEqual(parseManagedProcessProbe("", managed), []);
});

test("managedExecutablePids resolves the live managed process ids", async () => {
  const state = { probes: 0 };
  assert.deepEqual(await managedExecutablePids(managed, scriptedRunner(state)), [42]);
});

test("waitForManagedExecutableExit polls until the executable disappears", async () => {
  const state = { probes: 0 };
  await waitForManagedExecutableExit(managed, new AbortController().signal, { runner: scriptedRunner(state), intervalMs: 1, timeoutMs: 100 });
  assert.equal(state.probes, 3);
});

test("waitForManagedExecutableExit times out while a managed process still runs", async () => {
  await assert.rejects(
    waitForManagedExecutableExit(managed, new AbortController().signal, { runner: async () => ({ stdout: JSON.stringify({ ProcessId: 42, ExecutablePath: managed }) }), intervalMs: 1, timeoutMs: 2 }),
    /still running/,
  );
});

test("waitForManagedExecutableExit ignores unrelated same-named executables", async () => {
  const otherOnly = async () => ({ stdout: JSON.stringify({ ProcessId: 99, ExecutablePath: "D:\\Unrelated\\steamcmd.exe" }) });
  await waitForManagedExecutableExit(managed, new AbortController().signal, { runner: otherOnly, intervalMs: 1, timeoutMs: 2 });
  console.log("MANAGED_STEAMCMD_PROCESS_GUARD_OK");
});
