import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_CATEGORIES,
  auditCsvFileName,
  buildAuditEvents,
  categorizeActivity,
  csvEscape,
  filterAuditEvents,
  normalizeAuditFilters,
  paginateAuditEvents,
  toAuditCsv,
  type AuditEvent,
} from "../src/lib/audit-trail";

test("audit trail: activity kinds map to the right categories", () => {
  for (const kind of ["power", "stopped", "cancelled", "crashed", "guardrail"]) assert.equal(categorizeActivity(kind, "x"), "power", kind);
  assert.equal(categorizeActivity("backup", "Backup done"), "backups");
  assert.equal(categorizeActivity("task", "Task ran"), "tasks");
  assert.equal(categorizeActivity("player", "Steve whitelisted"), "roster");
  assert.equal(categorizeActivity("security", "PIN unlock failed (3 attempts left)"), "security");
  assert.equal(categorizeActivity("settings", "File server.properties saved on Lobby (safety copy server.properties.bak-20261001-120000)"), "files");
  assert.equal(categorizeActivity("settings", "Export bundle created for Lobby"), "files");
  assert.equal(categorizeActivity("settings", "Retention changed"), "other");
  assert.equal(categorizeActivity("install", "Installed"), "other");
});

test("audit trail: all sources merge into one newest-first timeline with server names", () => {
  const events = buildAuditEvents({
    activity: [
      { serverId: 1, kind: "power", message: "Lobby started", ts: new Date("2026-10-01T10:00:00Z") },
      { serverId: null, kind: "security", message: "PIN unlock succeeded", ts: new Date("2026-10-01T12:00:00Z") },
    ],
    taskRuns: [
      { serverId: 2, taskName: "nightly", type: "backup", status: "succeeded", error: "", createdAt: new Date("2026-10-01T11:00:00Z") },
      { serverId: 9, taskName: "ghost", type: "command", status: "failed", error: "boom", createdAt: new Date("2026-10-01T09:00:00Z") },
    ],
    moderation: [
      { serverId: 1, action: "ban", target: "Griefer99", reason: "griefing", status: "applied", createdAt: new Date("2026-10-01T10:30:00Z") },
    ],
    serverNames: new Map([[1, "Lobby"], [2, "Arena"]]),
  });
  assert.deepEqual(
    events.map((event) => event.summary),
    ["PIN unlock succeeded", 'Task "nightly" succeeded', "ban Griefer99", "Lobby started", 'Task "ghost" failed'],
    "sorted newest first"
  );
  assert.equal(events[0].serverName, "Panel", "panel-level events have no server");
  assert.equal(events[0].category, "security");
  assert.equal(events[1].serverName, "Arena");
  assert.equal(events[2].category, "roster");
  assert.equal(events[2].detail, "applied — griefing");
  assert.equal(events[4].serverName, "server 9", "unknown servers degrade gracefully");
  assert.equal(events[4].detail, "command — boom");
});

test("audit trail: filter normalization and application", () => {
  const defaults = normalizeAuditFilters({});
  assert.deepEqual(defaults, { categories: [], serverId: null, q: "", fromMs: null, toMs: null, limit: 50, offset: 0 });
  const full = normalizeAuditFilters({ categories: "power,security,bogus,power", serverId: "3", q: "  Steve  ", from: "2026-10-02T00:00:00Z", to: "2026-10-01T00:00:00Z", limit: "500", offset: "-2" });
  assert.deepEqual(full.categories, ["power", "security"], "deduped and validated");
  assert.equal(full.serverId, 3);
  assert.equal(full.q, "Steve");
  assert.ok(full.fromMs! < full.toMs!, "inverted ranges are swapped");
  assert.equal(full.limit, 50, "out-of-range limit falls back");
  assert.equal(full.offset, 0);

  const events: AuditEvent[] = [
    { at: "2026-10-01T12:00:00.000Z", category: "security", serverId: null, serverName: "Panel", summary: "PIN unlock failed", detail: "" },
    { at: "2026-10-01T11:00:00.000Z", category: "power", serverId: 1, serverName: "Lobby", summary: "Lobby started", detail: "power" },
    { at: "2026-09-25T11:00:00.000Z", category: "roster", serverId: 1, serverName: "Lobby", summary: "ban Steve", detail: "applied" },
  ];
  assert.equal(filterAuditEvents(events, normalizeAuditFilters({ categories: "security" })).length, 1);
  assert.equal(filterAuditEvents(events, normalizeAuditFilters({ serverId: "1" })).length, 2);
  assert.equal(filterAuditEvents(events, normalizeAuditFilters({ q: "steve" })).length, 1, "search is case-insensitive");
  assert.equal(filterAuditEvents(events, normalizeAuditFilters({ q: "lobby" })).length, 2, "search covers the server name");
  assert.equal(filterAuditEvents(events, normalizeAuditFilters({ from: "2026-10-01T00:00:00Z" })).length, 2, "date range applies");
});

test("audit trail: pagination slices without losing the total", () => {
  const events: AuditEvent[] = Array.from({ length: 120 }, (_, i) => ({
    at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    category: AUDIT_CATEGORIES[i % AUDIT_CATEGORIES.length],
    serverId: 1,
    serverName: "Lobby",
    summary: `event ${i}`,
    detail: "",
  }));
  const pageOne = paginateAuditEvents(events, normalizeAuditFilters({ limit: "50" }));
  assert.equal(pageOne.events.length, 50);
  assert.equal(pageOne.total, 120);
  const pageThree = paginateAuditEvents(events, normalizeAuditFilters({ limit: "50", offset: "100" }));
  assert.equal(pageThree.events.length, 20, "the last page is short");
  assert.equal(pageThree.events[0].summary, "event 100");
});

test("audit trail: CSV is RFC-4180 shaped and the file name is stamped", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape("line\nbreak"), '"line\nbreak"');
  // formula-injection neutralization: a hostile player name can never
  // become a live formula when the CSV is opened in Excel or Sheets
  assert.equal(csvEscape("=HYPERLINK(evil)"), "'=HYPERLINK(evil)");
  assert.equal(csvEscape("+1234"), "'+1234");
  assert.equal(csvEscape("-cmd"), "'-cmd");
  assert.equal(csvEscape("@module"), "'@module");
  assert.equal(csvEscape("=a,b"), "\"'=a,b\"", "neutralizing composes with quoting");
  assert.equal(csvEscape("safe = inside"), "safe = inside", "only a leading trigger is neutralized");
  const csv = toAuditCsv([
    { at: "2026-10-01T12:00:00.000Z", category: "files", serverId: 1, serverName: "Lobby, EU", summary: 'File "x" saved', detail: "" },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "at,category,server,summary,detail");
  assert.equal(lines[1], '2026-10-01T12:00:00.000Z,files,"Lobby, EU","File ""x"" saved",');
  assert.equal(lines[2], "", "trailing CRLF");
  assert.equal(auditCsvFileName(new Date(2026, 9, 1, 9, 5, 7)), "audit-trail-20261001-090507.csv");
  console.log("AUDIT_TRAIL_SUITE_OK");
});
