// F56 (v2.65.0) — panel access log. Pure dedupe/cap/summary logic, the
// user-agent shortener, the sidecar round-trip (cap enforcement and
// corrupt-file tolerance), and pinned wiring into the request gate,
// the unlock route, and the Tools page.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ACCESS_LOG_CAP,
  type AccessEvent,
  callerIp,
  capEntries,
  clearAccessLog,
  describeAgent,
  isVisitPath,
  loadAccessLog,
  recordAccess,
  resetAccessLogState,
  shouldRecord,
  summarizeAccess,
  visitKey,
} from "../src/lib/access-log";

const UA_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const UA_CHROME = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function ev(partial: Partial<AccessEvent>): AccessEvent {
  return { ts: 0, ip: "127.0.0.1", userAgent: UA_EDGE, kind: "visit", path: "/", ...partial };
}

test("visits dedupe per browser per window; security events never dedupe", () => {
  const key = visitKey("127.0.0.1", UA_EDGE);
  const first = shouldRecord("visit", key, {}, 1_000_000);
  assert.equal(first.record, true);
  const repeat = shouldRecord("visit", key, first.lastSeen, 1_000_000 + 5 * 60_000);
  assert.equal(repeat.record, false, "same browser five minutes later is the same session");
  const later = shouldRecord("visit", key, first.lastSeen, 1_000_000 + 16 * 60_000);
  assert.equal(later.record, true, "a new window is a new visit");
  const otherBrowser = shouldRecord("visit", visitKey("127.0.0.1", UA_CHROME), first.lastSeen, 1_000_000 + 1);
  assert.equal(otherBrowser.record, true, "a different browser is always a distinct visitor");
  for (const kind of ["locked", "unlock-ok", "unlock-fail", "denied"] as const) {
    assert.equal(shouldRecord(kind, key, first.lastSeen, 1_000_000 + 1).record, true, `${kind} must always be recorded`);
  }
});

test("capEntries keeps the newest entries, newest first", () => {
  const entries = Array.from({ length: 10 }, (_, i) => ev({ ts: i }));
  const capped = capEntries(entries, 3);
  assert.deepEqual(capped.map((e) => e.ts), [9, 8, 7]);
});

test("describeAgent shortens real user agents", () => {
  assert.equal(describeAgent(UA_EDGE), "Edge", "Edge ships a Chrome token — Edg/ must win");
  assert.equal(describeAgent(UA_CHROME), "Chrome");
  assert.equal(describeAgent("Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/130.0"), "Firefox");
  assert.equal(describeAgent("Mozilla/5.0 ServerHub Electron/31.0.0 Chrome/126"), "Server Hub app");
  assert.equal(describeAgent(""), "Unknown client");
});

test("summary counts the last 24h and finds the last visit", () => {
  const now = 100 * 24 * 60 * 60 * 1000;
  const entries = capEntries([
    ev({ ts: now - 1000, kind: "visit" }),
    ev({ ts: now - 2000, kind: "unlock-fail" }),
    ev({ ts: now - 3000, kind: "unlock-ok", userAgent: UA_CHROME }),
    ev({ ts: now - 4000, kind: "locked" }),
    ev({ ts: now - 5000, kind: "denied" }),
    ev({ ts: now - 25 * 60 * 60 * 1000, kind: "visit" }), // outside the window
  ]);
  const s = summarizeAccess(entries, now);
  assert.equal(s.visits24h, 1);
  assert.equal(s.unlockFails24h, 1);
  assert.equal(s.unlockOks24h, 1);
  assert.equal(s.locked24h, 1);
  assert.equal(s.denied24h, 1);
  assert.deepEqual(s.agents24h, ["Chrome", "Edge"]);
  assert.equal(s.lastVisit, now - 1000);
});

test("callerIp and isVisitPath classify requests", () => {
  assert.equal(callerIp(null), "127.0.0.1");
  assert.equal(callerIp("10.0.0.9, 127.0.0.1"), "10.0.0.9");
  assert.equal(isVisitPath("/servers/3"), true);
  assert.equal(isVisitPath("/api/servers"), false);
  assert.equal(isVisitPath("/_next/data/x"), false);
  assert.equal(isVisitPath("/favicon.ico"), false);
});

test("sidecar round-trip: append, cap, clear, and corrupt-file tolerance", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "accesslog-"));
  resetAccessLogState();
  await recordAccess({ kind: "visit", ip: "127.0.0.1", userAgent: UA_EDGE, path: "/" }, base);
  await recordAccess({ kind: "visit", ip: "127.0.0.1", userAgent: UA_EDGE, path: "/servers" }, base); // deduped
  await recordAccess({ kind: "unlock-fail", ip: "127.0.0.1", userAgent: UA_EDGE, path: "/api/security/pin/unlock" }, base);
  const entries = await loadAccessLog(base);
  assert.equal(entries.length, 2, "second visit deduped in-process");
  assert.equal(entries[0].kind, "unlock-fail", "newest first");
  // The ring never grows past the cap.
  const file = path.join(base, "access-log.json");
  const big = Array.from({ length: ACCESS_LOG_CAP + 50 }, (_, i) => ev({ ts: i + 1, kind: "locked" }));
  writeFileSync(file, JSON.stringify({ entries: big }));
  assert.equal((await loadAccessLog(base)).length, ACCESS_LOG_CAP);
  resetAccessLogState();
  await recordAccess({ kind: "locked", ip: "127.0.0.1", userAgent: UA_EDGE, path: "/" }, base);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { entries: AccessEvent[] };
  assert.equal(parsed.entries.length, ACCESS_LOG_CAP, "append re-caps the stored ring");
  // Corrupt sidecar degrades to empty, never throws.
  writeFileSync(file, "{nope");
  assert.deepEqual(await loadAccessLog(base), []);
  await clearAccessLog(base);
  assert.deepEqual(await loadAccessLog(base), []);
});

test("wiring is pinned: gate, unlock route, API route, Tools page", () => {
  const proxy = readFileSync("src/proxy.ts", "utf8");
  assert.ok(proxy.includes('logAccess(request, "denied")'), "boundary rejections are logged");
  assert.ok(proxy.includes('logAccess(request, "locked")'), "lock-screen bounces are logged");
  assert.ok(proxy.includes('isVisitPath(request.nextUrl.pathname)) logAccess(request, "visit")'), "GET page visits are logged");
  const unlock = readFileSync("src/app/api/security/pin/unlock/route.ts", "utf8");
  assert.ok(unlock.includes('logUnlock("unlock-fail")'));
  assert.ok(unlock.includes('logUnlock("unlock-ok")'));
  const route = readFileSync("src/app/api/security/access-log/route.ts", "utf8");
  assert.ok(route.includes("summarizeAccess(entries)"));
  assert.ok(route.includes("clearAccessLog()"));
  const tools = readFileSync("src/app/tools/page.tsx", "utf8");
  assert.ok(tools.includes("<AccessLogPanel />"));
  console.log("ACCESS_LOG_SUITE_OK");
});
