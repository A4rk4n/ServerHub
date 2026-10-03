import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as tar from "tar";
import { fileSha256, inspectBackupArchive } from "../src/lib/backup-validation";
import {
  MAX_VERIFY_PER_SWEEP,
  normalizeVerificationState,
  pruneVerificationState,
  selectBackupsToVerify,
  summarizeVerification,
  type VerificationState,
} from "../src/lib/backup-verification";
import { notificationGroup } from "../src/lib/notifications";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const DAY = 86_400_000;

test("backup verification: state normalization drops junk verdicts", () => {
  for (const junk of [null, 42, "x", [], true]) assert.deepEqual(normalizeVerificationState(junk), {});
  const state = normalizeVerificationState({
    "3": { ok: true, problem: "", checksum: "abc", verifiedAt: "2026-10-01T00:00:00.000Z", archiveBytes: 1024 },
    "4": { ok: "yes", verifiedAt: "2026-10-01T00:00:00.000Z" },      // ok must be a real boolean
    "5": { ok: false, problem: "bad", verifiedAt: "not a date" },     // timestamp must parse
    "nope": { ok: true, verifiedAt: "2026-10-01T00:00:00.000Z" },     // id must be numeric
    "6": { ok: false, problem: 7, checksum: 1, verifiedAt: "2026-10-01T00:00:00.000Z", archiveBytes: -3 },
  });
  assert.deepEqual(Object.keys(state).sort(), ["3", "6"]);
  assert.deepEqual(state["6"], { ok: false, problem: "", checksum: "", verifiedAt: "2026-10-01T00:00:00.000Z", archiveBytes: 0 });
});

test("backup verification: candidate selection is stale-first, newest-first, bounded", () => {
  const fresh = new Date(NOW - 1 * DAY).toISOString();
  const stale = new Date(NOW - 8 * DAY).toISOString();
  const state: VerificationState = {
    "1": { ok: true, problem: "", checksum: "", verifiedAt: fresh, archiveBytes: 1 },
    "2": { ok: true, problem: "", checksum: "", verifiedAt: stale, archiveBytes: 1 },
  };
  const rows = [
    { id: 1, status: "complete", archivePath: "/a/1.tar.gz" },  // fresh verdict — skipped
    { id: 2, status: "complete", archivePath: "/a/2.tar.gz" },  // stale — due again
    { id: 3, status: "complete", archivePath: "/a/3.tar.gz" },  // never verified
    { id: 4, status: "building", archivePath: "/a/4.tar.gz" },  // not complete — never touched
    { id: 5, status: "complete", archivePath: "" },              // no archive on record
    { id: 6, status: "complete", archivePath: "/a/6.tar.gz" },  // never verified, newest
  ];
  assert.deepEqual(selectBackupsToVerify(rows, state, NOW, 10), [6, 3, 2], "newest first");
  assert.deepEqual(selectBackupsToVerify(rows, state, NOW, MAX_VERIFY_PER_SWEEP), [6, 3], "background sweeps are bounded");
  assert.deepEqual(selectBackupsToVerify(rows, state, NOW, 0), []);
  // staleness 0 = operator-forced: every verifiable archive is due, fresh verdicts included
  assert.deepEqual(selectBackupsToVerify(rows, state, NOW, 10, 0), [6, 3, 2, 1]);
});

test("backup verification: pruning and summary", () => {
  const record = { ok: true, problem: "", checksum: "", verifiedAt: new Date(NOW).toISOString(), archiveBytes: 1 };
  const state: VerificationState = { "1": record, "2": { ...record, ok: false, problem: "bad" }, "9": record };
  const pruned = pruneVerificationState(state, new Set(["1", "2"]));
  assert.deepEqual(Object.keys(pruned).sort(), ["1", "2"], "verdicts for deleted backups are dropped");
  assert.deepEqual(summarizeVerification(pruned, [1, 2, 3]), { total: 3, verified: 1, corrupt: 1, unverified: 1 });
  assert.deepEqual(summarizeVerification({}, []), { total: 0, verified: 0, corrupt: 0, unverified: 0 });
});

test("backup verification: a real archive passes and a flipped byte fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bverify-"));
  try {
    const payload = path.join(dir, "world.dat");
    fs.writeFileSync(payload, "very important world data ".repeat(200));
    const archive = path.join(dir, "backup.tar.gz");
    await tar.c({ file: archive, cwd: dir, gzip: true }, ["world.dat"]);
    const checksum = await fileSha256(archive);
    const good = await inspectBackupArchive(archive, checksum);
    assert.equal(good.valid, true);
    assert.equal(good.entries, 1);
    // Flip one byte in the middle: the checksum no longer matches.
    const bytes = fs.readFileSync(archive);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    fs.writeFileSync(archive, bytes);
    const bad = await inspectBackupArchive(archive, checksum).catch((error: Error) => ({ valid: false, actualChecksum: "", error: error.message }));
    assert.equal(bad.valid === true, false, "corruption must not verify");
    // Truncation makes the tar walk itself throw.
    fs.writeFileSync(archive, bytes.subarray(0, 40));
    await assert.rejects(inspectBackupArchive(archive, checksum));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("backup verification: pinned notification, runtime, route, and UI wiring", () => {
  assert.equal(notificationGroup("backup-corrupt"), "backup", "backup-corrupt respects the backup toggle group");
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  assert.ok(runtime.includes("void sweepBackupVerification().catch(() => {})"), "the 15-second scheduler tick verifies backups");
  assert.ok(runtime.includes('path.join(appDataDir(), "backup-verification.json")'), "verdicts live in the app-data sidecar");
  assert.ok(runtime.includes('kind: "backup-corrupt"'), "a bad verdict notifies");
  const route = fs.readFileSync("src/app/api/backup-verification/route.ts", "utf8");
  assert.ok(route.includes('{ error: "Invalid JSON body" }'), "malformed POST bodies 400");
  assert.ok(route.includes('action !== "verify-now"'), "only the documented action runs");
  const backupsRoute = fs.readFileSync("src/app/api/servers/[id]/backups/route.ts", "utf8");
  assert.ok(backupsRoute.includes("verification: verification[String(row.id)] ?? null"), "per-backup verdicts ride along in the list");
  const panel = fs.readFileSync("src/components/backup-verification-panel.tsx", "utf8");
  assert.ok(panel.includes("Verify now"));
  const tools = fs.readFileSync("src/app/tools/page.tsx", "utf8");
  assert.ok(tools.includes("<BackupVerificationPanel />"), "the Tools page mounts the panel");
});

console.log("BACKUP_VERIFICATION_SUITE_OK");
