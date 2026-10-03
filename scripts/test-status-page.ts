import assert from "node:assert/strict";
import test from "node:test";
import { pinExemptPath } from "../src/lib/pin-lock";
import {
  DEFAULT_STATUS_TITLE,
  buildStatusSnapshot,
  formatUptime,
  generateStatusToken,
  normalizeStatusConfig,
  publicStatusLabel,
  safeTokenEquals,
  statusAccess,
} from "../src/lib/status-page";

test("status page: config normalization and token generation", () => {
  assert.deepEqual(normalizeStatusConfig(undefined), { enabled: false, token: "", title: DEFAULT_STATUS_TITLE });
  const good = normalizeStatusConfig({ enabled: true, token: "abcDEF123456789_-xyz", title: "  My Realm  " });
  assert.deepEqual(good, { enabled: true, token: "abcDEF123456789_-xyz", title: "My Realm" });
  assert.equal(normalizeStatusConfig({ enabled: true, token: "" }).enabled, false, "enabled requires a token");
  assert.equal(normalizeStatusConfig({ enabled: true, token: "short" }).token, "", "tokens under 16 chars are rejected");
  assert.equal(normalizeStatusConfig({ enabled: true, token: "has spaces in it here" }).token, "", "non-url-safe tokens are rejected");
  assert.equal(normalizeStatusConfig({ title: "x".repeat(200), token: "abcDEF123456789_-xyz" }).title.length, 60, "title is capped");

  const token = generateStatusToken();
  assert.match(token, /^[A-Za-z0-9_-]{32}$/, "24 random bytes become 32 url-safe chars");
  assert.notEqual(generateStatusToken(), token, "tokens are random");
  const fixed = generateStatusToken((n) => Buffer.alloc(n, 7));
  assert.equal(fixed, Buffer.alloc(24, 7).toString("base64url"), "rng is injectable");
});

test("status page: access decisions — disabled 404s, wrong tokens 401, exact token passes", () => {
  const off = normalizeStatusConfig({ enabled: false, token: "abcDEF123456789_-xyz" });
  assert.deepEqual(statusAccess(off, "abcDEF123456789_-xyz"), { ok: false, status: 404, problem: "Not found" });
  const on = normalizeStatusConfig({ enabled: true, token: "abcDEF123456789_-xyz" });
  assert.equal(statusAccess(on, "").ok, false);
  assert.equal((statusAccess(on, "wrong-token-wrong-t") as { status: number }).status, 401);
  assert.deepEqual(statusAccess(on, "abcDEF123456789_-xyz"), { ok: true });

  assert.equal(safeTokenEquals("", ""), false, "empty never matches");
  assert.equal(safeTokenEquals("abc", "abd"), false);
  assert.equal(safeTokenEquals("abc", "abcd"), false, "length mismatch is safe");
  assert.equal(safeTokenEquals("abc", "abc"), true);
});

test("status page: the snapshot is whitelist-built — sensitive input fields cannot leak", () => {
  const now = new Date("2026-10-01T15:00:00Z");
  const rows = [
    {
      name: "Lobby",
      gameName: "Minecraft",
      version: "26.3",
      loader: "fabric",
      status: "online",
      maxPlayers: 20,
      onlineCount: 5,
      lastStartedAt: new Date("2026-10-01T12:00:00Z"),
      // hostile extras that must never appear in the output
      serverPassword: "hunter2",
      adminPassword: "root",
      launchCommand: "C:\\secret\\server.exe",
      port: 25565,
    },
    { name: "Arena", gameName: "Rust", version: "2026.9", loader: "vanilla", status: "crashed", maxPlayers: 100, onlineCount: 0, lastStartedAt: null },
  ] as never[];
  const snapshot = buildStatusSnapshot("My Realm", rows, now);
  assert.equal(snapshot.title, "My Realm");
  assert.equal(snapshot.generatedAt, now.toISOString());
  assert.deepEqual(snapshot.totals, { servers: 2, online: 1, players: 5 });
  assert.deepEqual(snapshot.servers.map((row) => row.name), ["Arena", "Lobby"], "sorted by name");
  const lobby = snapshot.servers[1];
  assert.deepEqual(Object.keys(lobby).sort(), ["game", "name", "players", "status", "uptime", "uptimeSec", "version"], "exactly the whitelisted keys");
  assert.equal(lobby.uptime, null, "no history input means a null uptime strip");
  assert.equal(JSON.stringify(snapshot).includes("hunter2"), false);
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  assert.equal(lobby.version, "26.3 (fabric)", "non-vanilla loaders are shown");
  assert.equal(snapshot.servers[0].version, "2026.9", "vanilla loader stays implicit");
  assert.equal(lobby.uptimeSec, 3 * 3600);
  assert.equal(snapshot.servers[0].uptimeSec, null, "offline servers show no uptime");
});

test("status page: public labels collapse internal states; uptime formats humanely", () => {
  assert.equal(publicStatusLabel("online"), "online");
  for (const down of ["offline", "crashed", "error"]) assert.equal(publicStatusLabel(down), "offline");
  for (const busy of ["installing", "updating", "starting", "stopping", "unknown-future-state"]) assert.equal(publicStatusLabel(busy), "maintenance");

  assert.equal(formatUptime(42), "42s");
  assert.equal(formatUptime(185), "3m");
  assert.equal(formatUptime(3 * 3600 + 15 * 60), "3h 15m");
  assert.equal(formatUptime(50 * 3600 + 1800), "2d 2h");
});

test("status page: PIN exemptions cover exactly the public surface", () => {
  assert.ok(pinExemptPath("/status"), "the shared page bypasses the PIN (token-guarded instead)");
  assert.ok(pinExemptPath("/api/status"), "the public endpoint bypasses the PIN");
  assert.ok(!pinExemptPath("/api/status-page"), "the admin settings route stays behind the PIN");
  assert.ok(!pinExemptPath("/status/anything"), "only the exact page path is exempt");
  assert.ok(!pinExemptPath("/api/statuses"), "prefix lookalikes stay gated");
  console.log("STATUS_PAGE_SUITE_OK");
});
