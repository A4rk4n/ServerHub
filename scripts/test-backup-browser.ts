// Unit suite for the backup browser: real tar.gz archives built on
// the fly, entry listing with truncation, single-entry reads with the
// memory cap, zip-slip-style path sanitization, text-preview typing,
// and the wiring that keeps single-file restore behind the same gates
// as a full restore.

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as tar from "tar";

import {
  ENTRY_DOWNLOAD_MAX_BYTES,
  PREVIEW_MAX_BYTES,
  isProbablyTextEntry,
  listBackupEntries,
  readBackupEntry,
  sanitizeArchiveEntryPath,
} from "../src/lib/backup-browser";

async function buildArchive(): Promise<{ archive: string; cleanup: () => Promise<void> }> {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hub-browser-"));
  const root = path.join(base, "server");
  await fsp.mkdir(path.join(root, "world", "region"), { recursive: true });
  await fsp.writeFile(path.join(root, "server.properties"), "motd=Hello\nmax-players=20\n", "utf8");
  await fsp.writeFile(path.join(root, "world", "level.dat"), Buffer.from([1, 2, 3, 4, 5]));
  await fsp.writeFile(path.join(root, "world", "region", "r.0.0.mca"), Buffer.alloc(2048, 7));
  const archive = path.join(base, "backup.tar.gz");
  await tar.c({ cwd: root, file: archive, gzip: true, portable: true, strict: true }, await fsp.readdir(root));
  return { archive, cleanup: () => fsp.rm(base, { recursive: true, force: true }) };
}

test("listing returns files and directories with sizes, sorted, with truncation", async () => {
  const { archive, cleanup } = await buildArchive();
  try {
    const { entries, truncated } = await listBackupEntries(archive);
    assert.equal(truncated, false);
    const paths = entries.map((entry) => entry.path);
    assert.ok(paths.includes("server.properties"));
    assert.ok(paths.includes("world/region/r.0.0.mca"));
    assert.deepEqual([...paths].sort((a, b) => a.localeCompare(b)), paths, "entries come back sorted");
    const region = entries.find((entry) => entry.path === "world/region/r.0.0.mca")!;
    assert.equal(region.size, 2048);
    assert.equal(region.type, "file");
    assert.equal(entries.find((entry) => entry.path === "world")?.type, "dir");
    const capped = await listBackupEntries(archive, 2);
    assert.equal(capped.entries.length, 2);
    assert.equal(capped.truncated, true, "past the limit the listing truncates instead of throwing");
  } finally {
    await cleanup();
  }
});

test("single entries read back exactly, respect the memory cap, and miss cleanly", async () => {
  const { archive, cleanup } = await buildArchive();
  try {
    const text = await readBackupEntry(archive, "server.properties");
    assert.equal(text?.toString("utf8"), "motd=Hello\nmax-players=20\n");
    const binary = await readBackupEntry(archive, "world/level.dat");
    assert.deepEqual([...(binary ?? Buffer.alloc(0))], [1, 2, 3, 4, 5]);
    assert.equal(await readBackupEntry(archive, "world/region"), null, "directories are not readable entries");
    assert.equal(await readBackupEntry(archive, "no/such/file.txt"), null);
    assert.equal(await readBackupEntry(archive, "../../etc/passwd"), null, "unsafe paths never match");
    await assert.rejects(() => readBackupEntry(archive, "world/region/r.0.0.mca", 1024), /larger than/, "oversized entries throw instead of ballooning memory");
  } finally {
    await cleanup();
  }
});

test("archive paths sanitize against traversal in both slash styles", () => {
  assert.equal(sanitizeArchiveEntryPath("world/level.dat"), "world/level.dat");
  assert.equal(sanitizeArchiveEntryPath("./server.properties"), "server.properties");
  assert.equal(sanitizeArchiveEntryPath("world//region///file"), "world/region/file");
  assert.equal(sanitizeArchiveEntryPath("world\\level.dat"), "world/level.dat", "backslashes normalize");
  for (const bad of ["../evil", "/etc/passwd", "a/../../b", "C:\\windows\\system32", "a/./b", "", "   ", 42, null, "x".repeat(2000)]) {
    assert.equal(sanitizeArchiveEntryPath(bad as string), null, `rejects ${JSON.stringify(bad)}`);
  }
});

test("text preview typing covers config formats and nothing binary", () => {
  for (const good of ["server.properties", "config/paper.yml", "ops.json", "logs/latest.log", "Settings.INI", "readme.md"]) {
    assert.ok(isProbablyTextEntry(good), `${good} previews as text`);
  }
  for (const bad of ["world/level.dat", "region/r.0.0.mca", "server.jar", "icon.png", "noextension"]) {
    assert.ok(!isProbablyTextEntry(bad), `${bad} does not preview`);
  }
  assert.ok(PREVIEW_MAX_BYTES < ENTRY_DOWNLOAD_MAX_BYTES, "preview cap is tighter than the download cap");
});

test("single-file restore sits behind the same gates as a full restore", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("export async function restoreBackupEntry"), "the runtime exposes single-entry restore");
  const body = runtime.slice(runtime.indexOf("export async function restoreBackupEntry"));
  assert.ok(body.includes("Stop the server before restoring"), "a running server blocks single-file restore");
  assert.ok(body.includes("Backup checksum verification failed"), "the archive checksum verifies before extraction");
  assert.ok(body.includes("sanitizeArchiveEntryPath"), "the entry path is sanitized");
  assert.ok(body.includes("That file is not in this backup"), "the entry must exist in the archive");
  const route = fs.readFileSync("src/app/api/servers/[id]/backups/[bid]/route.ts", "utf8");
  assert.ok(route.includes('action === "restore-entry"'), "the backup route handles restore-entry");
  const entriesRoute = fs.readFileSync("src/app/api/servers/[id]/backups/[bid]/entries/route.ts", "utf8");
  assert.ok(entriesRoute.includes("listBackupEntries") && entriesRoute.includes("readBackupEntry"), "the entries route lists and reads");
  assert.ok(entriesRoute.includes("isProbablyTextEntry"), "previews are limited to text formats");
  const ui = fs.readFileSync("src/components/backups-manager.tsx", "utf8");
  assert.ok(ui.includes("BackupBrowser"), "the backups manager renders the browser");
  assert.ok(ui.includes("Restore this single file"), "restoring one file confirms the exact path");
  console.log("BACKUP_BROWSER_SUITE_OK");
});
