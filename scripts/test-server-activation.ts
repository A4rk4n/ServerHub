import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activateServerStaging } from "../src/lib/server-activation";

async function text(file: string) {
  return fsp.readFile(file, "utf8");
}

let temp: string;

before(async () => {
  temp = await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-activation-"));
});

after(async () => {
  await fsp.rm(temp, { recursive: true, force: true });
});

test("a failed post-swap verification restores the previous installation", async () => {
  const root = path.join(temp, "server");
  const stage = path.join(temp, "stage");
  const previous = path.join(temp, "previous");
  await fsp.mkdir(root);
  await fsp.writeFile(path.join(root, "generation"), "old");
  await fsp.mkdir(stage);
  await fsp.writeFile(path.join(stage, "generation"), "bad");
  await assert.rejects(
    activateServerStaging(root, stage, previous, async () => {
      throw new Error("injected post-swap verification failure");
    }),
    /injected/,
  );
  assert.equal(await text(path.join(root, "generation")), "old");
  await assert.rejects(fsp.stat(previous));
});

test("a verified staging swap activates the new generation atomically", async () => {
  const root = path.join(temp, "server");
  const previous = path.join(temp, "previous");
  const good = path.join(temp, "good");
  await fsp.mkdir(good);
  await fsp.writeFile(path.join(good, "generation"), "new");
  const result = await activateServerStaging(root, good, previous, async (activated) =>
    assert.equal(await text(path.join(activated, "generation")), "new"),
  );
  assert.deepEqual(result, { replacedExisting: true });
  assert.equal(await text(path.join(root, "generation")), "new");
  await assert.rejects(fsp.stat(previous));
});

test("a failed first activation leaves no partial installation behind", async () => {
  const fresh = path.join(temp, "fresh");
  const freshStage = path.join(temp, "fresh-stage");
  await fsp.mkdir(freshStage);
  await assert.rejects(
    activateServerStaging(fresh, freshStage, path.join(temp, "fresh-previous"), async () => {
      throw new Error("fresh invalid");
    }),
    /fresh invalid/,
  );
  await assert.rejects(fsp.stat(fresh));
  console.log("SERVER_ACTIVATION_ROLLBACK_OK");
});
