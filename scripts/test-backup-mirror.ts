import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  MIRROR_ARCHIVE_PATTERN,
  formatMirrorNote,
  mirrorRelativePath,
  normalizeMirrorConfig,
  normalizeMirrorState,
  planMirrorSync,
  summarizeMirrorHealth,
  validateMirrorDirectory,
} from "../src/lib/backup-mirror";

test("backup mirror: config normalization and directory safety", () => {
  assert.deepEqual(normalizeMirrorConfig(undefined), { enabled: false, directory: "" });
  assert.deepEqual(normalizeMirrorConfig({ enabled: true, directory: "  /mnt/nas/hub  " }), { enabled: true, directory: "/mnt/nas/hub" });
  assert.equal(normalizeMirrorConfig({ enabled: true, directory: "" }).enabled, false, "enabled requires a directory");
  assert.equal(normalizeMirrorConfig({ enabled: "yes", directory: "/x" }).enabled, false, "truthy strings are not true");

  const appData = path.resolve("/home/user/.serverhub");
  assert.equal(validateMirrorDirectory("/mnt/nas/hub", appData), null);
  assert.equal(typeof validateMirrorDirectory("", appData), "string", "empty directory is rejected");
  assert.equal(typeof validateMirrorDirectory("relative/dir", appData), "string", "relative paths are rejected");
  assert.match(validateMirrorDirectory(path.join(appData, "mirror"), appData)!, /inside the Server Hub data directory/);
  assert.match(validateMirrorDirectory(path.resolve("/home/user"), appData)!, /lives inside that path/);
  assert.match(validateMirrorDirectory(appData, appData)!, /inside the Server Hub data directory/, "the data dir itself is rejected");
});

test("backup mirror: state normalization drops malformed entries", () => {
  assert.deepEqual(normalizeMirrorState(undefined), { version: 1, entries: {} });
  assert.deepEqual(normalizeMirrorState("junk"), { version: 1, entries: {} });
  const state = normalizeMirrorState({
    version: 1,
    entries: {
      "7": { status: "mirrored", file: "server-2/000007-nightly.tar.gz", checksum: "abc", mirroredAt: "2026-10-01T10:00:00.000Z" },
      "8": { status: "failed", file: "server-2/000008-nightly.tar.gz", checksum: "", mirroredAt: "2026-10-01T11:00:00.000Z", error: "disk full" },
      "not-a-number": { status: "mirrored", file: "x.tar.gz", checksum: "", mirroredAt: "" },
      "9": { status: "weird", file: "y.tar.gz" },
      "10": { status: "mirrored" },
    },
  });
  assert.deepEqual(Object.keys(state.entries).sort(), ["7", "8"]);
  assert.equal(state.entries["8"].error, "disk full");
  assert.equal(state.entries["7"].error, undefined, "no error key is materialized for healthy entries");
});

test("backup mirror: sync planning copies the missing, keeps the verified, flags the stale", () => {
  const backups = [
    { id: 1, serverId: 2, status: "complete", archiveBasename: "000001-first.tar.gz" },
    { id: 2, serverId: 2, status: "complete", archiveBasename: "000002-second.tar.gz" },
    { id: 3, serverId: 2, status: "building", archiveBasename: "000003-wip.tar.gz" },
    { id: 4, serverId: 5, status: "complete", archiveBasename: "000004-other.tar.gz" },
    { id: 5, serverId: 2, status: "complete", archiveBasename: "../escape.tar.gz" },
  ];
  const state = normalizeMirrorState({
    version: 1,
    entries: {
      "1": { status: "mirrored", file: "server-2/000001-first.tar.gz", checksum: "aa", mirroredAt: "x" },
      "2": { status: "failed", file: "server-2/000002-second.tar.gz", checksum: "", mirroredAt: "x", error: "boom" },
    },
  });
  const mirrorFiles = new Set(["server-2/000001-first.tar.gz", "server-9/000099-pruned.tar.gz"]);
  const plan = planMirrorSync(backups, state, mirrorFiles);
  assert.deepEqual(plan.upToDate, [1], "verified copy still on disk stays");
  assert.deepEqual(plan.toCopy, [2, 4], "failed entries retry, unmirrored copy; building and unsafe names never copy");
  assert.deepEqual(plan.stale, ["server-9/000099-pruned.tar.gz"], "only unowned files matching our naming are stale");

  // a mirrored state entry whose file vanished from the mirror is re-copied
  const gone = planMirrorSync(backups.slice(0, 1), state, new Set<string>());
  assert.deepEqual(gone.toCopy, [1]);
});

test("backup mirror: layout names are strict and traversal-proof", () => {
  assert.equal(mirrorRelativePath(2, "000042-nightly-world.tar.gz"), "server-2/000042-nightly-world.tar.gz");
  assert.throws(() => mirrorRelativePath(0, "000042-a.tar.gz"));
  assert.throws(() => mirrorRelativePath(2, "../../etc/passwd"));
  assert.throws(() => mirrorRelativePath(2, "000042-a.tar.gz.part"));
  assert.throws(() => mirrorRelativePath(2, "no-prefix.tar.gz"));
  assert.equal(MIRROR_ARCHIVE_PATTERN.test("000001-ok_name.v2.tar.gz"), true);
  assert.equal(MIRROR_ARCHIVE_PATTERN.test("000001-bad name.tar.gz"), false);
});

test("backup mirror: health summary and digest note", () => {
  const rows = [
    { id: 1, status: "complete" },
    { id: 2, status: "complete" },
    { id: 3, status: "complete" },
    { id: 4, status: "failed" },
  ];
  const state = normalizeMirrorState({
    version: 1,
    entries: {
      "1": { status: "mirrored", file: "server-1/000001-a.tar.gz", checksum: "aa", mirroredAt: "x" },
      "2": { status: "failed", file: "server-1/000002-b.tar.gz", checksum: "", mirroredAt: "x", error: "checksum mismatch" },
    },
  });
  const health = summarizeMirrorHealth(rows, state);
  assert.deepEqual(health, { eligible: 3, mirrored: 1, pending: 1, failed: 1, lastError: "checksum mismatch" });

  assert.equal(formatMirrorNote({ enabled: false, directory: "" }, health), "", "disabled mirror adds nothing to the digest");
  assert.equal(formatMirrorNote({ enabled: true, directory: "/m" }, health), "🪞 Backup mirror: 1/3 mirrored · 1 pending · ⚠️ 1 FAILED");
  assert.equal(
    formatMirrorNote({ enabled: true, directory: "/m" }, { eligible: 2, mirrored: 2, pending: 0, failed: 0, lastError: null }),
    "🪞 Backup mirror: 2/2 mirrored"
  );
  assert.match(formatMirrorNote({ enabled: true, directory: "/m" }, { eligible: 0, mirrored: 0, pending: 0, failed: 0, lastError: null }), /no backups to mirror yet/);
  console.log("BACKUP_MIRROR_SUITE_OK");
});
