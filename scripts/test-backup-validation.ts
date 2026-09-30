import assert from "node:assert/strict";
import test from "node:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { fileSha256, inspectBackupArchive } from "../src/lib/backup-validation";

async function withFixture(run: (paths: { root: string; archive: string }) => Promise<void>) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-backup-test-"));
  try {
    const source = path.join(root, "source");
    await fsp.mkdir(source);
    await fsp.writeFile(path.join(source, "world.dat"), "fixture");
    const archive = path.join(root, "good.tar.gz");
    await tar.c({ cwd: source, file: archive, gzip: true }, ["world.dat"]);
    await run({ root, archive });
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("a well-formed archive validates against its recorded checksum", async () => {
  await withFixture(async ({ archive }) => {
    const hash = await fileSha256(archive);
    const good = await inspectBackupArchive(archive, hash);
    assert.equal(good.valid, true);
    assert.equal(good.entries, 1);
  });
});

test("an archive is rejected when the recorded checksum does not match", async () => {
  await withFixture(async ({ archive }) => {
    assert.equal((await inspectBackupArchive(archive, "0".repeat(64))).valid, false);
  });
});

test("a truncated archive is rejected as damaged", async () => {
  await withFixture(async ({ root, archive }) => {
    const damaged = path.join(root, "damaged.tar.gz");
    const bytes = await fsp.readFile(archive);
    await fsp.writeFile(damaged, bytes.subarray(0, Math.max(8, bytes.length / 2)));
    await assert.rejects(() => inspectBackupArchive(damaged));
  });
  console.log("BACKUP_CORRUPTION_REGRESSION_OK");
});
