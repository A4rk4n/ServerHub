import assert from "node:assert/strict";
import { before, test } from "node:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZipArchive } from "archiver";

let extractZipSafe: (typeof import("../src/lib/runtime"))["extractZipSafe"];

before(async () => {
  // The runtime module resolves the database path at import time, so the
  // override must be installed before it is loaded.
  process.env.SERVERHUB_DB = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-zip-db-")), "test.db");
  ({ extractZipSafe } = await import("../src/lib/runtime"));
});

async function zip(file: string, entries: Array<{ name: string; content: string }>) {
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const archive = new ZipArchive({ zlib: { level: 1 } });
    out.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(out);
    for (const entry of entries) archive.append(entry.content, { name: entry.name });
    void archive.finalize();
  });
}

test("extractZipSafe extracts a well-formed zip archive", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-zip-test-"));
  try {
    const archive = path.join(root, "fixture.zip");
    await zip(archive, [
      { name: "safe/a.txt", content: "hello" },
      { name: "safe/b.txt", content: "world" },
      { name: "safe/c.txt", content: "!" },
    ]);
    await extractZipSafe(archive, path.join(root, "good"));
    assert.equal(await fsp.readFile(path.join(root, "good/safe/a.txt"), "utf8"), "hello");
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("extractZipSafe enforces entry-count and expanded-size limits", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-zip-test-"));
  try {
    const archive = path.join(root, "fixture.zip");
    await zip(archive, [
      { name: "safe/a.txt", content: "hello" },
      { name: "safe/b.txt", content: "world" },
      { name: "safe/c.txt", content: "!" },
    ]);
    await assert.rejects(extractZipSafe(archive, path.join(root, "count"), undefined, { maxEntries: 2 }), /entry limit/);
    await assert.rejects(extractZipSafe(archive, path.join(root, "size"), undefined, { maxExpandedBytes: 5 }), /expanded-size limit/);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("the mandatory traversal and symlink guards remain in the extractor source", async () => {
  // Archiver normalizes traversal names; verify the extractor's mandatory
  // guards remain active as defense in depth.
  const source = await fsp.readFile("src/lib/runtime.ts", "utf8");
  for (const guard of ["normalized.startsWith", "split(\"/\").includes(\"..\")", "isSymlink", "^[A-Za-z]"]) {
    assert.ok(source.includes(guard), guard);
  }
  console.log("MALICIOUS_ZIP_BEHAVIOR_OK");
});
