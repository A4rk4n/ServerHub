// Server notes / runbook (v2.67.0) — normalization (CRLF folding,
// trailing-whitespace trim, hard cap), the preview helper, the
// sidecar round-trip (write, overwrite, empty-deletes, ghost cleanup,
// corrupt-file tolerance), and pinned wiring into the API route, the
// Settings page, and the server-deletion cleanup.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_NOTES_CHARS,
  deleteServerNotes,
  normalizeNotes,
  notesFile,
  notesPreview,
  readAllServerNotes,
  readServerNotes,
  writeServerNotes,
} from "../src/lib/server-notes";

test("normalizeNotes folds CRLF, trims the tail, enforces the cap", () => {
  assert.equal(normalizeNotes("line one\r\nline two\r\n\r\n  "), "line one\nline two");
  assert.equal(normalizeNotes(""), "");
  assert.equal(normalizeNotes("  leading stays\nkept  \n"), "  leading stays\nkept", "leading whitespace is the operator's formatting");
  assert.equal(normalizeNotes(42), null, "non-strings are rejected, never coerced");
  assert.equal(normalizeNotes("x".repeat(MAX_NOTES_CHARS)), "x".repeat(MAX_NOTES_CHARS));
  assert.equal(normalizeNotes("x".repeat(MAX_NOTES_CHARS + 1)), null, "over the cap is rejected, not truncated");
});

test("notesPreview finds the first real line and ellipsizes", () => {
  assert.equal(notesPreview("\n\n  \n- restart nightly\nmore"), "- restart nightly");
  assert.equal(notesPreview(""), "");
  assert.equal(notesPreview("a".repeat(100), 20), `${"a".repeat(19)}…`);
});

test("sidecar round-trip: write, overwrite, empty-deletes, ghost cleanup", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "servernotes-"));
  assert.equal(await readServerNotes(7, base), null, "missing file is just no notes");
  const saved = await writeServerNotes(7, "Needs 20 min warmup before first backup", base, 1234);
  assert.deepEqual(saved, { text: "Needs 20 min warmup before first backup", updatedAt: 1234 });
  await writeServerNotes(9, "Second server", base, 2000);
  assert.equal((await readServerNotes(7, base))!.text, "Needs 20 min warmup before first backup");
  // Overwrite updates text and timestamp.
  await writeServerNotes(7, "Rewritten", base, 5678);
  assert.deepEqual(await readServerNotes(7, base), { text: "Rewritten", updatedAt: 5678 });
  // Saving empty text removes the entry entirely.
  assert.equal(await writeServerNotes(7, "", base), null);
  assert.equal(await readServerNotes(7, base), null);
  assert.equal((await readServerNotes(9, base))!.text, "Second server", "neighbours untouched");
  // Deletion cleanup never leaves ghosts and tolerates absent entries.
  await deleteServerNotes(9, base);
  await deleteServerNotes(9, base);
  assert.deepEqual(await readAllServerNotes(base), {});
});

test("corrupt or hostile sidecar degrades to empty, never throws", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "servernotes-"));
  writeFileSync(notesFile(base), "{broken");
  assert.deepEqual(await readAllServerNotes(base), {});
  writeFileSync(notesFile(base), JSON.stringify({ "3": { text: 42, updatedAt: 1 }, "4": "nope", "5": { text: "ok", updatedAt: 9 } }));
  const all = await readAllServerNotes(base);
  assert.deepEqual(Object.keys(all), ["5"], "malformed entries are dropped, valid ones survive");
});

test("wiring is pinned: route validates, Settings page renders, deletion cleans up", () => {
  const route = readFileSync("src/app/api/servers/[id]/notes/route.ts", "utf8");
  assert.ok(route.includes("normalizeNotes(body.text)"));
  assert.ok(route.includes("writeServerNotes(server.id, text)"));
  assert.ok(route.includes("a string `text` is required"), "malformed JSON never wipes a runbook");
  const page = readFileSync("src/app/servers/[id]/settings/page.tsx", "utf8");
  assert.ok(page.includes("<NotesPanel serverId={s.id} />"));
  const serverRoute = readFileSync("src/app/api/servers/[id]/route.ts", "utf8");
  assert.ok(serverRoute.includes("deleteServerNotes(s.id)"), "deleting a server deletes its notes");
  console.log("SERVER_NOTES_SUITE_OK");
});
