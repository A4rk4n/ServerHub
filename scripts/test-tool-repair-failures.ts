import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  activateStagedTool,
  restoreToolRollback,
  type ToolRepairFileOps,
} from "../src/lib/tool-repair-filesystem";

async function text(file: string) {
  return fsp.readFile(file, "utf8");
}

let temp: string;

before(async () => {
  temp = await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-tool-repair-"));
  const root = path.join(temp, "steamcmd");
  await fsp.mkdir(root);
  await fsp.writeFile(path.join(root, "identity.txt"), "original");
});

after(async () => {
  await fsp.rm(temp, { recursive: true, force: true });
});

// A failed staged activation must restore the exact previous installation.
test("a failed staged activation restores the previous installation", async () => {
  const root = path.join(temp, "steamcmd");
  const staged = path.join(temp, "missing-stage");
  const rollback = path.join(temp, "steamcmd.rollback-1");
  await assert.rejects(activateStagedTool(root, staged, rollback));
  assert.equal(await text(path.join(root, "identity.txt")), "original");
  await assert.rejects(fsp.stat(rollback));
});

// A failure while swapping in a rollback must recover the current install.
test("an injected rollback-swap failure recovers the current install", async () => {
  const root = path.join(temp, "steamcmd");
  const retained = path.join(temp, "steamcmd.rollback-2");
  const displaced = path.join(temp, "steamcmd.replaced-test");
  await fsp.mkdir(retained);
  await fsp.writeFile(path.join(retained, "identity.txt"), "older");
  let injected = false;
  const ops: ToolRepairFileOps = {
    mkdir: fsp.mkdir,
    rm: fsp.rm,
    stat: fsp.stat,
    rename: async (from, to) => {
      if (from === retained && to === root && !injected) {
        injected = true;
        throw Object.assign(new Error("injected rollback activation failure"), { code: "EIO" });
      }
      return fsp.rename(from, to);
    },
  };
  await assert.rejects(restoreToolRollback(root, retained, displaced, ops), /injected/);
  assert.equal(await text(path.join(root, "identity.txt")), "original");
  assert.equal(await text(path.join(retained, "identity.txt")), "older");
  await assert.rejects(fsp.stat(displaced));
});

// Successful activation and rollback preserve the expected generations.
test("successful activation and rollback preserve the expected generations", async () => {
  const root = path.join(temp, "steamcmd");
  const next = path.join(temp, "next");
  const retained3 = path.join(temp, "steamcmd.rollback-3");
  await fsp.mkdir(next);
  await fsp.writeFile(path.join(next, "identity.txt"), "new");
  assert.deepEqual(await activateStagedTool(root, next, retained3), { rollbackAvailable: true });
  assert.equal(await text(path.join(root, "identity.txt")), "new");
  await restoreToolRollback(root, retained3, path.join(temp, "displaced-success"));
  assert.equal(await text(path.join(root, "identity.txt")), "original");
  await assert.rejects(fsp.stat(retained3));
  console.log("TOOL_REPAIR_FAILURE_INJECTION_OK");
});
