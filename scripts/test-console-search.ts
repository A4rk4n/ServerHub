import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SEARCH_LIMIT,
  EXPORT_MAX_LINES,
  MAX_SCAN_ROWS,
  MAX_SEARCH_LIMIT,
  collectMatches,
  compileMatcher,
  exportFileName,
  formatLogLine,
  normalizeSearchParams,
} from "../src/lib/console-search";

test("console search: parameter normalization", () => {
  const defaults = normalizeSearchParams({});
  assert.deepEqual(defaults, { q: "", regex: false, levels: [], source: "", fromMs: null, toMs: null, limit: DEFAULT_SEARCH_LIMIT, cursor: null });

  const full = normalizeSearchParams({
    q: "  OutOfMemory  ",
    regex: "1",
    levels: "error,warn,ERROR,bogus",
    source: "Runtime",
    from: "2026-10-01T00:00:00.000Z",
    to: "1790899200000",
    limit: "100",
    cursor: "4242",
  });
  assert.equal(full.q, "OutOfMemory");
  assert.equal(full.regex, true);
  assert.deepEqual(full.levels, ["error", "warn"], "levels are deduped, lowercased, and validated");
  assert.equal(full.source, "Runtime");
  assert.equal(full.fromMs, Date.parse("2026-10-01T00:00:00.000Z"));
  assert.equal(full.toMs, 1790899200000, "epoch-ms timestamps are accepted alongside ISO strings");
  assert.equal(full.limit, 100);
  assert.equal(full.cursor, 4242);

  // swapped ranges are repaired; junk falls back
  const swapped = normalizeSearchParams({ from: "2026-10-02T00:00:00Z", to: "2026-10-01T00:00:00Z", limit: "99999", cursor: "-5" });
  assert.ok(swapped.fromMs! < swapped.toMs!);
  assert.equal(swapped.limit, DEFAULT_SEARCH_LIMIT);
  assert.equal(swapped.cursor, null);
  assert.equal(normalizeSearchParams({ limit: String(MAX_SEARCH_LIMIT) }).limit, MAX_SEARCH_LIMIT);
  assert.equal(normalizeSearchParams({ q: "x".repeat(500) }).q.length, 200, "query length is capped");
});

test("console search: matcher semantics", () => {
  const line = (level: string, source: string, message: string) => ({ level, source, message });
  const text = compileMatcher(normalizeSearchParams({ q: "heap SPACE" }));
  assert.ok(text.ok);
  if (text.ok) {
    assert.equal(text.test(line("error", "Server", "java.lang.OutOfMemoryError: Java heap space")), true, "text match is case-insensitive");
    assert.equal(text.test(line("info", "Server", "all good")), false);
  }
  const rx = compileMatcher(normalizeSearchParams({ q: "joined|left the game", regex: "1" }));
  assert.ok(rx.ok);
  if (rx.ok) {
    assert.equal(rx.test(line("info", "Server", "Steve joined")), true);
    assert.equal(rx.test(line("info", "Server", "Steve LEFT THE GAME")), true);
    assert.equal(rx.test(line("info", "Server", "Steve is idle")), false);
  }
  const bad = compileMatcher(normalizeSearchParams({ q: "([", regex: "1" }));
  assert.equal(bad.ok, false);
  const emptyRx = compileMatcher(normalizeSearchParams({ regex: "1" }));
  assert.equal(emptyRx.ok, false, "regex mode requires a pattern");
  const filtered = compileMatcher(normalizeSearchParams({ levels: "error", source: "run" }));
  assert.ok(filtered.ok);
  if (filtered.ok) {
    assert.equal(filtered.test(line("error", "Runtime", "boom")), true, "source filter is a case-insensitive substring");
    assert.equal(filtered.test(line("warn", "Runtime", "boom")), false, "level filter applies");
    assert.equal(filtered.test(line("error", "Backup", "boom")), false, "source filter applies");
  }
});

test("console search: pagination collects up to the limit within a scan budget", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: 100 - i, level: i % 2 === 0 ? "error" : "info", source: "Server", message: `line ${100 - i}` }));
  const matcher = compileMatcher(normalizeSearchParams({ levels: "error" }));
  assert.ok(matcher.ok);
  if (!matcher.ok) return;
  const page = collectMatches(rows, matcher, 10, 1000);
  assert.equal(page.matched.length, 10);
  assert.equal(page.scanned, 19, "stops as soon as the limit is reached");
  assert.equal(page.lastExaminedId, rows[18].id);
  assert.equal(page.exhaustedBudget, false);
  const budget = collectMatches(rows, matcher, 100, 7);
  assert.equal(budget.scanned, 7);
  assert.equal(budget.exhaustedBudget, true, "a spent budget is reported so the caller can hand out a cursor");
  assert.ok(MAX_SCAN_ROWS >= 1000 && EXPORT_MAX_LINES >= 10_000, "server-side budgets stay generous");
});

test("console search: exported lines are aligned and complete", () => {
  const formatted = formatLogLine({ ts: "2026-10-01T10:00:00.000Z", level: "warn", source: "Runtime", message: "Graceful stop timed out" });
  assert.equal(formatted, "2026-10-01T10:00:00.000Z [warn   ] [Runtime] Graceful stop timed out");
  const fromDate = formatLogLine({ ts: new Date(Date.UTC(2026, 9, 1, 12, 30, 0)), level: "command", source: "Console", message: "say hi" });
  assert.equal(fromDate, "2026-10-01T12:30:00.000Z [command] [Console] say hi");
});

test("console search: export file names are slugged and stamped", () => {
  const now = new Date(2026, 9, 1, 9, 5, 7);
  assert.equal(exportFileName("Lobby One", now), "lobby-one-console-20261001-090507.log");
  assert.equal(exportFileName("!!!", now), "server-console-20261001-090507.log");
  assert.match(exportFileName("Überserver 99", now), /^berserver-99-console-\d{8}-\d{6}\.log$/);
  console.log("CONSOLE_SEARCH_SUITE_OK");
});
