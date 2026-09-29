import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { fileSha256, inspectBackupArchive } from "../src/lib/backup-validation";

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-backup-test-"));
  try {
    const source = path.join(root, "source");
    await fsp.mkdir(source);
    await fsp.writeFile(path.join(source, "world.dat"), "fixture");
    const archive = path.join(root, "good.tar.gz");
    await tar.c({ cwd: source, file: archive, gzip: true }, ["world.dat"]);
    const hash = await fileSha256(archive);
    const good = await inspectBackupArchive(archive, hash);
    assert.equal(good.valid, true);
    assert.equal(good.entries, 1);
    assert.equal((await inspectBackupArchive(archive, "0".repeat(64))).valid, false);
    const damaged = path.join(root, "damaged.tar.gz");
    const bytes = await fsp.readFile(archive);
    await fsp.writeFile(damaged, bytes.subarray(0, Math.max(8, bytes.length / 2)));
    await assert.rejects(() => inspectBackupArchive(damaged));
    console.log("BACKUP_CORRUPTION_REGRESSION_OK");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => { console.error(error); process.exit(1); });
