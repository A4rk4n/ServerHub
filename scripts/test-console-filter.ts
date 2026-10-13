// Unit suite for the pure console filtering and export helpers backing the
// console view's severity pills, search box, and visible-slice download.

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSOLE_FILTERS,
  type ConsoleLine,
  consoleSliceFileName,
  filterConsoleLines,
  formatConsoleSlice,
  matchesConsoleLevel,
} from "../src/lib/console-filter";

const line = (id: number, level: string, source: string, message: string): ConsoleLine => ({
  id,
  ts: `2026-09-30T12:00:0${id}.000Z`,
  level,
  source,
  message,
});

const fixture: ConsoleLine[] = [
  line(1, "info", "Server", "Preparing spawn area"),
  line(2, "warn", "Watchdog", "Tick took 2400ms"),
  line(3, "error", "Server", "Failed to bind port 25565"),
  line(4, "command", "Console", "say Hello everyone"),
  line(5, "system", "Backup", "Snapshot nightly-1 complete"),
  line(6, "info", "Server", "Player Steve joined the game"),
];

test("the all filter passes every line untouched", () => {
  assert.deepEqual(filterConsoleLines(fixture, "all", ""), fixture);
});

test("severity pills select exactly their level, except warn which includes errors", () => {
  assert.deepEqual(filterConsoleLines(fixture, "info", "").map((l) => l.id), [1, 6]);
  assert.deepEqual(filterConsoleLines(fixture, "warn", "").map((l) => l.id), [2, 3]);
  assert.deepEqual(filterConsoleLines(fixture, "error", "").map((l) => l.id), [3]);
  assert.deepEqual(filterConsoleLines(fixture, "command", "").map((l) => l.id), [4]);
  assert.deepEqual(filterConsoleLines(fixture, "system", "").map((l) => l.id), [5]);
  assert.equal(matchesConsoleLevel(fixture[2], "warn"), true);
});

test("search is case-insensitive, trims the query, and also matches the source tag", () => {
  assert.deepEqual(filterConsoleLines(fixture, "all", "FAILED TO BIND").map((l) => l.id), [3]);
  assert.deepEqual(filterConsoleLines(fixture, "all", "  steve  ").map((l) => l.id), [6]);
  assert.deepEqual(filterConsoleLines(fixture, "all", "watchdog").map((l) => l.id), [2]);
  assert.deepEqual(filterConsoleLines(fixture, "all", "no such text"), []);
});

test("level filter and search compose", () => {
  assert.deepEqual(filterConsoleLines(fixture, "warn", "server").map((l) => l.id), [3]);
  assert.deepEqual(filterConsoleLines(fixture, "info", "failed"), []);
});

test("a blank query never filters, preserving the original order", () => {
  for (const filter of CONSOLE_FILTERS) {
    const ids = filterConsoleLines(fixture, filter, "").map((l) => l.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  }
});

test("the exported slice contains exactly the visible lines, one per row", () => {
  const slice = formatConsoleSlice(filterConsoleLines(fixture, "warn", ""));
  assert.equal(slice, "2026-09-30T12:00:02.000Z [WARN] [Watchdog] Tick took 2400ms\n2026-09-30T12:00:03.000Z [ERROR] [Server] Failed to bind port 25565\n");
  assert.equal(formatConsoleSlice([]), "");
});

test("download file names are per-server, sortable, and filesystem-safe", () => {
  const name = consoleSliceFileName(7, new Date("2026-09-30T14:05:09.123Z"));
  assert.equal(name, "serverhub-7-console-2026-09-30-14-05-09.log");
  assert.doesNotMatch(name, /[:\\/\s]/);
  console.log("CONSOLE_FILTER_SUITE_OK");
});
