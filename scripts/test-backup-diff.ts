// Backup-vs-live diff (F60, v2.70.0) — comparison classification over
// the F50 diff engine (identical / changed / live-missing), the
// verdict wording and direction convention (backup = before, live =
// after), and pinned wiring: path-traversal guard and text gate in
// the route, Diff button and hunk view in the backup browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareBackupToLive } from "../src/lib/backup-diff";

test("identical copies produce no diff and a calming summary", () => {
  const result = compareBackupToLive("a\nb\nc", "a\nb\nc");
  assert.equal(result.state, "identical");
  assert.equal(result.diff, null);
  assert.ok(result.summary.includes("matches this backup exactly"));
});

test("a deleted live file is a first-class answer, not an error", () => {
  const result = compareBackupToLive("max-players=6\n", null);
  assert.equal(result.state, "live-missing");
  assert.equal(result.diff, null);
  assert.ok(result.summary.includes("restoring would bring it back"));
});

test("changes are counted from the live file's point of view", () => {
  // Backup had port=7777; live gained a line and changed one.
  const backup = "port=7777\nmax-players=6\n";
  const live = "port=7778\nmax-players=6\npassword=secret\n";
  const result = compareBackupToLive(backup, live);
  assert.equal(result.state, "changed");
  assert.ok(result.diff, "changed comparisons carry hunks");
  assert.equal(result.diff!.added, 2, "the changed line plus the new line");
  assert.equal(result.diff!.removed, 1, "the old port line restoring would bring back");
  assert.ok(result.summary.includes("2 lines added, 1 line removed"), "plural and singular forms");
  assert.ok(result.summary.includes("Restoring overwrites the live copy"));
  // Direction convention: deletions are backup-side lines.
  const delLines = result.diff!.hunks.flatMap((h) => h.lines).filter((l) => l.type === "del").map((l) => l.text);
  assert.deepEqual(delLines, ["port=7777"]);
  const addLines = result.diff!.hunks.flatMap((h) => h.lines).filter((l) => l.type === "add").map((l) => l.text);
  assert.deepEqual(addLines, ["port=7778", "password=secret"]);
});

test("wiring is pinned: route guards, browser shows Diff", () => {
  const route = readFileSync("src/app/api/servers/[id]/backups/[bid]/diff/route.ts", "utf8");
  assert.ok(route.includes("sanitizeArchiveEntryPath"), "archive paths are sanitized");
  assert.ok(route.includes("isProbablyTextEntry"), "binary files are rejected as text diffs");
  assert.ok(route.includes('livePath !== root && !livePath.startsWith(root + path.sep)'), "the live path cannot escape the server directory");
  assert.ok(route.includes("liveText = null; // deleted since the backup"), "missing live file degrades to live-missing");
  assert.ok(route.includes("compareBackupToLive(buffer.toString"));
  const ui = readFileSync("src/components/backups-manager.tsx", "utf8");
  assert.ok(ui.includes("What changed since this backup?"));
  assert.ok(ui.includes("/diff?path="));
  assert.ok(ui.includes("backup line {hunk.aStart}"), "hunk headers label both sides");
  console.log("BACKUP_DIFF_SUITE_OK");
});
