// F54 — webhook payload formats (v2.63.0).
// Slack and generic-JSON templates alongside Discord, auto-detection from
// the URL, explicit overrides for compatible endpoints on other hosts,
// config round-trip discipline, and the delivery path honoring the choice.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  WEBHOOK_FORMATS,
  attemptDelivery,
  buildWebhookBody,
  isSlackWebhook,
  resolveWebhookFormat,
  type NotificationConfig,
} from "../src/lib/notifications";

const SLACK = "https://hooks.slack.com/services/T000/B000/XXXX";
const DISCORD = "https://discord.com/api/webhooks/1/token";
const OTHER = "https://alerts.example.com/hook";

test("resolveWebhookFormat: auto detects by URL, explicit choice always wins", () => {
  assert.equal(resolveWebhookFormat(DISCORD), "discord");
  assert.equal(resolveWebhookFormat(SLACK), "slack");
  assert.equal(resolveWebhookFormat(OTHER), "json");
  assert.equal(isSlackWebhook(SLACK), true);
  assert.equal(isSlackWebhook("https://hooks.slack.evil.com/x"), false, "hostname must be exact");
  // Explicit format overrides detection — Mattermost on its own host, Discord proxies.
  assert.equal(resolveWebhookFormat(OTHER, "slack"), "slack");
  assert.equal(resolveWebhookFormat(SLACK, "json"), "json");
  assert.equal(resolveWebhookFormat(OTHER, "discord"), "discord");
  assert.deepEqual([...WEBHOOK_FORMATS], ["auto", "discord", "slack", "json"]);
});

test("buildWebhookBody emits the right shape per format", () => {
  const event = { kind: "crash" as const, serverName: "Palserver", detail: "exit code 1" };
  // Slack: a single text field (Slack rejects payloads without it), single-asterisk bold.
  const slack = JSON.parse(buildWebhookBody(SLACK, event));
  assert.deepEqual(Object.keys(slack), ["text"]);
  assert.ok(slack.text.startsWith("Server Hub · "));
  assert.ok(slack.text.includes("*Palserver*"), "Discord ** bold becomes Slack * bold");
  assert.ok(!slack.text.includes("**"));
  // Forced Slack on a non-Slack host produces the same body.
  const forced = JSON.parse(buildWebhookBody(OTHER, event, new Date(), "slack"));
  assert.deepEqual(forced, slack);
  // Discord unchanged: content + suppressed mentions.
  const discord = JSON.parse(buildWebhookBody(DISCORD, event));
  assert.ok(discord.content.startsWith("**Server Hub** · "));
  assert.deepEqual(discord.allowed_mentions, { parse: [] });
  // Generic JSON unchanged (pre-v2.63 shape preserved for existing consumers).
  const generic = JSON.parse(buildWebhookBody(OTHER, event, new Date("2026-10-04T10:00:00Z")));
  assert.equal(generic.source, "serverhub");
  assert.equal(generic.kind, "crash");
  assert.equal(generic.server, "Palserver");
  assert.equal(generic.at, "2026-10-04T10:00:00.000Z");
});

test("config round-trip: format persists when real, never as the auto default", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "webhook-format-"));
  process.env.SERVERHUB_APPDATA = base;
  const { readNotificationConfig, writeNotificationConfig } = await import("../src/lib/notifications");
  // Legacy config without a format: reading must not invent one.
  writeFileSync(path.join(base, "notifications.json"), JSON.stringify({ url: OTHER, events: { status: true, crash: true, backup: true } }), "utf8");
  const legacy = await readNotificationConfig();
  assert.ok(!("format" in legacy), "legacy configs stay format-free");
  // A real format round-trips; junk formats are dropped on read.
  await writeNotificationConfig({ ...legacy, format: "slack" });
  assert.equal((await readNotificationConfig()).format, "slack");
  writeFileSync(path.join(base, "notifications.json"), JSON.stringify({ url: OTHER, format: "carrier-pigeon" }), "utf8");
  assert.ok(!("format" in (await readNotificationConfig())), "unknown formats are ignored");
  writeFileSync(path.join(base, "notifications.json"), JSON.stringify({ url: OTHER, format: "auto" }), "utf8");
  assert.ok(!("format" in (await readNotificationConfig())), "auto is the default, never carried");
  delete process.env.SERVERHUB_APPDATA;
});

test("attemptDelivery sends the configured format's body", async () => {
  const config: NotificationConfig = { url: OTHER, events: { status: true, crash: true, backup: true }, format: "slack" };
  let sentBody = "";
  const capturingFetch = (async (_url: unknown, init?: RequestInit) => {
    sentBody = String(init?.body ?? "");
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const outcome = await attemptDelivery(config, { kind: "crash", serverName: "Palserver" }, capturingFetch);
  assert.equal(outcome.sent, true);
  const parsed = JSON.parse(sentBody);
  assert.deepEqual(Object.keys(parsed), ["text"], "a generic URL with format slack gets a Slack body");
  // Without a format the same URL gets the generic JSON document.
  await attemptDelivery({ ...config, format: undefined }, { kind: "crash", serverName: "Palserver" }, capturingFetch);
  assert.equal(JSON.parse(sentBody).source, "serverhub");
});

test("wiring is pinned: route validation, panel selector, delivery line", () => {
  const route = readFileSync("src/app/api/notifications/route.ts", "utf8");
  assert.ok(route.includes("format must be one of auto, discord, slack, json"), "bad formats are rejected loudly");
  assert.ok(route.includes('...(format && format !== "auto" ? { format } : {}),'), "auto is never persisted");

  const lib = readFileSync("src/lib/notifications.ts", "utf8");
  assert.ok(lib.includes('buildWebhookBody(config.url, event, new Date(), config.format ?? "auto")'), "delivery honors the configured format");

  const panel = readFileSync("src/components/notifications-panel.tsx", "utf8");
  assert.ok(panel.includes("Payload format"));
  for (const label of ['"Auto"', '"Discord"', '"Slack"', '"JSON"']) assert.ok(panel.includes(label), `panel offers ${label}`);
  assert.ok(panel.includes('(config.format ?? "auto") === option.value'));

  console.log("WEBHOOK_FORMATS_SUITE_OK");
});
