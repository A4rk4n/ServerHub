// F48 — notification delivery history (v2.58.0).
// Pure ring-buffer lib + outcome-returning delivery + pinned wiring for the
// history endpoint, upgraded test route, and panel section.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_DELIVERY_HISTORY,
  appendDelivery,
  normalizeDeliveryHistory,
  redactWebhookTarget,
  summarizeDeliveries,
  type DeliveryRecord,
} from "../src/lib/notification-history";
import { attemptDelivery, deliverNotification, type NotificationConfig } from "../src/lib/notifications";

function record(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    at: "2026-10-03T10:00:00.000Z",
    kind: "crash",
    server: "Valheim",
    ok: true,
    status: 204,
    error: "",
    durationMs: 120,
    target: "discord.com",
    ...overrides,
  };
}

const config: NotificationConfig = {
  url: "https://discord.com/api/webhooks/123/secret-token",
  events: { status: true, crash: true, backup: true },
};

test("normalizeDeliveryHistory survives junk and enforces the cap", () => {
  assert.deepEqual(normalizeDeliveryHistory(null), []);
  assert.deepEqual(normalizeDeliveryHistory("nope"), []);
  assert.deepEqual(normalizeDeliveryHistory({ deliveries: [] }), []);
  // Junk entries dropped, valid ones kept intact.
  const mixed = normalizeDeliveryHistory([record(), null, 42, { at: "not-a-date", ok: true }, record({ ok: false, status: 500 })]);
  assert.equal(mixed.length, 2);
  assert.deepEqual(mixed[0], record());
  assert.equal(mixed[1].status, 500);
  // Field clamps: bad status/duration degrade to 0, long strings are sliced.
  const [clamped] = normalizeDeliveryHistory([record({ status: 7777, durationMs: -5, error: "x".repeat(500) })]);
  assert.equal(clamped.status, 0);
  assert.equal(clamped.durationMs, 0);
  assert.equal(clamped.error.length, 200);
  // Oversized files are truncated to the cap on read.
  const oversized = normalizeDeliveryHistory(Array.from({ length: 80 }, () => record()));
  assert.equal(oversized.length, MAX_DELIVERY_HISTORY);
  assert.equal(MAX_DELIVERY_HISTORY, 50);
});

test("appendDelivery keeps newest first, holds the cap, and never leaks the webhook URL", () => {
  let history: DeliveryRecord[] = [];
  for (let i = 0; i < 55; i++) history = appendDelivery(history, record({ at: `2026-10-03T10:00:${String(i % 60).padStart(2, "0")}.000Z`, status: 200 + i }));
  assert.equal(history.length, MAX_DELIVERY_HISTORY);
  assert.equal(history[0].status, 254); // last appended is first
  const older = history[0];
  const next = appendDelivery(history, record({ status: 999 }));
  assert.equal(next[0].status, 999);
  assert.equal(next[1], older);
  assert.equal(history.length, MAX_DELIVERY_HISTORY, "appendDelivery must not mutate its input");
  // Redaction: hostname only, junk degrades.
  assert.equal(redactWebhookTarget("https://discord.com/api/webhooks/123/secret-token"), "discord.com");
  assert.equal(redactWebhookTarget("not a url"), "invalid-url");
  assert.ok(!JSON.stringify(next).includes("secret-token"));
});

test("summarizeDeliveries reports totals and most-recent outcomes", () => {
  assert.deepEqual(summarizeDeliveries([]), { total: 0, failed: 0, lastSuccessAt: null, lastFailureAt: null });
  const history = [
    record({ at: "2026-10-03T12:00:00.000Z", ok: false, status: 500 }),
    record({ at: "2026-10-03T11:00:00.000Z", ok: true }),
    record({ at: "2026-10-03T10:00:00.000Z", ok: false, status: 0 }),
  ];
  const summary = summarizeDeliveries(history);
  assert.equal(summary.total, 3);
  assert.equal(summary.failed, 2);
  assert.equal(summary.lastSuccessAt, "2026-10-03T11:00:00.000Z");
  assert.equal(summary.lastFailureAt, "2026-10-03T12:00:00.000Z");
});

test("attemptDelivery returns full outcomes and deliverNotification stays boolean-compatible", async () => {
  const okFetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  const ok = await attemptDelivery(config, { kind: "crash", serverName: "Valheim" }, okFetch);
  assert.equal(ok.sent, true);
  assert.equal(ok.skipped, false);
  assert.equal(ok.status, 204);
  assert.equal(ok.error, "");

  const rejectedFetch = (async () => new Response("no", { status: 429 })) as typeof fetch;
  const rejected = await attemptDelivery(config, { kind: "crash", serverName: "Valheim" }, rejectedFetch);
  assert.equal(rejected.sent, false);
  assert.equal(rejected.skipped, false);
  assert.equal(rejected.status, 429);

  const deadFetch = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as unknown as typeof fetch;
  const dead = await attemptDelivery(config, { kind: "crash", serverName: "Valheim" }, deadFetch);
  assert.equal(dead.sent, false);
  assert.equal(dead.status, 0);
  assert.ok(dead.error.includes("ECONNREFUSED"));

  // Muted events are skipped — no attempt, so they must never be recorded.
  const muted: NotificationConfig = { ...config, events: { status: true, crash: false, backup: true } };
  let calls = 0;
  const countingFetch = (async () => {
    calls++;
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const skipped = await attemptDelivery(muted, { kind: "crash", serverName: "Valheim" }, countingFetch);
  assert.equal(skipped.skipped, true);
  assert.equal(calls, 0);

  // Back-compat wrapper.
  assert.equal(await deliverNotification(config, { kind: "crash", serverName: "Valheim" }, okFetch), true);
  assert.equal(await deliverNotification(config, { kind: "crash", serverName: "Valheim" }, rejectedFetch), false);
});

test("history wiring is pinned: recording path, endpoint, test route, and panel", () => {
  const lib = readFileSync("src/lib/notifications.ts", "utf8");
  // notify() records through deliverAndRecord; the pure attempt never writes.
  assert.ok(lib.includes("await deliverAndRecord(cachedConfig.config, event);"));
  assert.ok(lib.includes('"notification-history.json"'));
  assert.ok(lib.includes("if (!outcome.skipped)"), "muted events must not be recorded");
  assert.ok(lib.includes("target: redactWebhookTarget(config.url)"), "history must store the hostname, never the URL");

  const historyRoute = readFileSync("src/app/api/notifications/history/route.ts", "utf8");
  assert.ok(historyRoute.includes("readDeliveryHistory"));
  assert.ok(historyRoute.includes("summary: summarizeDeliveries(deliveries)"));

  const testRoute = readFileSync("src/app/api/notifications/test/route.ts", "utf8");
  assert.ok(testRoute.includes("deliverAndRecord"), "test sends must land in the history too");
  assert.ok(testRoute.includes("The webhook answered HTTP ${outcome.status}"));

  const panel = readFileSync("src/components/notifications-panel.tsx", "utf8");
  assert.ok(panel.includes("Recent deliveries"));
  assert.ok(panel.includes('fetch("/api/notifications/history"'));
  assert.ok(panel.includes("void loadHistory();"), "a test send must refresh the list");

  console.log("NOTIFICATION_HISTORY_SUITE_OK");
});
