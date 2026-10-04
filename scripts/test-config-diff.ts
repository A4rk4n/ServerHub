// F50 — config file history: multi-hunk diff + safety-copy restore (v2.60.0).
// Exact LCS hunks with per-hunk line numbers (the config editor's old
// preview collapses everything into one blob), safety-copy helpers, and
// pinned wiring for the files-manager history strip and restore flow.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DIFF_CONTEXT,
  diffFiles,
  parseSafetyStamp,
  safetyCopiesFor,
  safetyCopyOriginal,
} from "../src/lib/config-diff";

const lines = (...xs: string[]) => xs.join("\n");

test("identical files and single mid-file edits produce exact hunks", () => {
  assert.deepEqual(diffFiles("a\nb", "a\nb"), { identical: true, added: 0, removed: 0, hunks: [], truncated: false });

  const before = lines("one", "two", "three", "four", "five", "six", "seven", "eight", "nine");
  const after = lines("one", "two", "three", "four", "FIVE", "six", "seven", "eight", "nine");
  const d = diffFiles(before, after);
  assert.equal(d.identical, false);
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.equal(d.truncated, false);
  assert.equal(d.hunks.length, 1);
  const [hunk] = d.hunks;
  assert.equal(hunk.aStart, 2, "context starts DIFF_CONTEXT lines above the change");
  assert.equal(hunk.bStart, 2);
  assert.deepEqual(hunk.lines.map((l) => `${l.type}:${l.text}`), [
    "ctx:two", "ctx:three", "ctx:four", "del:five", "add:FIVE", "ctx:six", "ctx:seven", "ctx:eight",
  ]);
  assert.equal(DIFF_CONTEXT, 3);
});

test("separated edits become separate hunks; nearby edits merge", () => {
  const base = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`);
  // Two edits 20 lines apart -> two hunks.
  const farA = [...base];
  const farB = [...base];
  farB[2] = "CHANGED-3";
  farB[24] = "CHANGED-25";
  const far = diffFiles(farA.join("\n"), farB.join("\n"));
  assert.equal(far.hunks.length, 2, "edits 20 lines apart are separate hunks");
  assert.equal(far.hunks[0].aStart, 1);
  assert.equal(far.hunks[1].aStart, 22);
  assert.equal(far.added, 2);
  assert.equal(far.removed, 2);
  // Two edits 2 lines apart -> their context windows overlap into one hunk.
  const nearB = [...base];
  nearB[9] = "X";
  nearB[12] = "Y";
  const near = diffFiles(farA.join("\n"), nearB.join("\n"));
  assert.equal(near.hunks.length, 1, "edits inside shared context merge");
});

test("pure insertions, deletions, and edge-of-file changes keep line numbers honest", () => {
  const ins = diffFiles(lines("a", "b", "c"), lines("a", "b", "NEW", "c"));
  assert.equal(ins.added, 1);
  assert.equal(ins.removed, 0);
  assert.equal(ins.hunks.length, 1);
  const first = diffFiles(lines("a", "b", "c"), lines("A", "b", "c"));
  assert.equal(first.hunks[0].aStart, 1, "change on line 1 has no leading context");
  assert.equal(first.hunks[0].lines[0].type, "del");
  const tail = diffFiles(lines("a", "b", "c"), lines("a", "b"));
  assert.equal(tail.removed, 1);
  const delHunk = tail.hunks[0];
  assert.equal(delHunk.lines.filter((l) => l.type === "del").length, 1);
});

test("oversized middles degrade to a single truncated block instead of hanging", () => {
  // >4M LCS cells after prefix/suffix trim: 2100 changed lines each side.
  const bigA = Array.from({ length: 2100 }, (_, i) => `a-${i}-${i % 7}`).join("\n");
  const bigB = Array.from({ length: 2100 }, (_, i) => `b-${i}-${i % 5}`).join("\n");
  const d = diffFiles(bigA, bigB);
  assert.equal(d.truncated, true);
  assert.equal(d.removed, 2100);
  assert.equal(d.added, 2100);
  assert.ok(d.hunks.length >= 1);
  // Same size but identical except one line: trim makes it exact again.
  const almost = bigA.split("\n");
  almost[1000] = "DIFFERENT";
  const small = diffFiles(bigA, almost.join("\n"));
  assert.equal(small.truncated, false);
  assert.equal(small.hunks.length, 1);
});

test("safety-copy helpers parse stamps, sort newest first, and find the original", () => {
  const stamp = parseSafetyStamp("server.properties.bak-20261003-154530");
  assert.ok(stamp);
  assert.equal(stamp!.getFullYear(), 2026);
  assert.equal(stamp!.getMonth(), 9);
  assert.equal(stamp!.getHours(), 15);
  assert.equal(parseSafetyStamp("server.properties.bak-20261303-154530"), null, "month 13 is rejected");
  assert.equal(parseSafetyStamp("server.properties"), null);

  const paths = [
    "config/server.properties",
    "config/server.properties.bak-20261001-090000",
    "config/server.properties.bak-20261002-090000",
    "config/other.yml.bak-20261001-090000",
    "config/server.properties.bak-garbage",
  ];
  const copies = safetyCopiesFor("config/server.properties", paths);
  assert.deepEqual(copies.map((c) => c.path), [
    "config/server.properties.bak-20261002-090000",
    "config/server.properties.bak-20261001-090000",
  ], "newest first, other files and junk stamps excluded");
  assert.deepEqual(safetyCopiesFor("config/server.properties.bak-20261001-090000", paths), [], "copies have no copies");

  assert.equal(safetyCopyOriginal("config/server.properties.bak-20261002-090000"), "config/server.properties");
  assert.equal(safetyCopyOriginal("config/server.properties"), null);
});

test("wiring is pinned: history strip, compare modal, and restore flow", () => {
  const manager = readFileSync("src/components/files-manager.tsx", "utf8");
  assert.ok(manager.includes('from "@/lib/config-diff"'));
  assert.ok(manager.includes("File history:"), "history strip lists safety copies");
  assert.ok(manager.includes("Safety copy of"), "selecting a copy shows its origin banner");
  assert.ok(manager.includes("Restore this version"));
  assert.ok(manager.includes("restoring keeps the replaced file as a new safety copy"), "restore reuses writeServerFile so the replaced version is preserved");
  assert.ok(manager.includes("JSON.stringify({ path: original, content: copyText, force: true })"), "restore writes through the existing files PUT");
  assert.ok(manager.includes("file too large for an exact diff"));
  console.log("CONFIG_DIFF_SUITE_OK");
});
