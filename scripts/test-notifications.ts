// Unit suite for outbound webhook notifications: config handling, event
// grouping, payload shapes (Discord vs generic), bounded delivery, and
// the runtime emission wiring.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.SERVERHUB_APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), "serverhub-notify-"));

import {
  DEFAULT_NOTIFICATION_CONFIG,
  buildWebhookBody,
  deliverNotification,
  isDiscordWebhook,
  notificationGroup,
  readNotificationConfig,
  shouldNotify,
  validateWebhookUrl,
  writeNotificationConfig,
} from "../src/lib/notifications";

const DISCORD = "https://discord.com/api/webhooks/123/abc";

test("events map to their toggle groups and tests always fire", () => {
  assert.equal(notificationGroup("online"), "status");
  assert.equal(notificationGroup("offline"), "status");
  assert.equal(notificationGroup("crash"), "crash");
  assert.equal(notificationGroup("auto-restart"), "crash");
  assert.equal(notificationGroup("restart-limit"), "crash");
  assert.equal(notificationGroup("backup-complete"), "backup");
  assert.equal(notificationGroup("backup-failed"), "backup");
  assert.equal(notificationGroup("test"), "always");
  const config = { url: DISCORD, events: { status: false, crash: true, backup: false } };
  assert.equal(shouldNotify(config, "online"), false);
  assert.equal(shouldNotify(config, "crash"), true);
  assert.equal(shouldNotify(config, "backup-complete"), false);
  assert.equal(shouldNotify(config, "test"), true);
  assert.equal(shouldNotify({ ...config, url: "" }, "crash"), false, "no URL disables everything");
});

test("webhook URL validation accepts http(s) or empty and rejects everything else", () => {
  assert.equal(validateWebhookUrl(""), null);
  assert.equal(validateWebhookUrl(DISCORD), null);
  assert.equal(validateWebhookUrl("http://192.168.1.50:9000/hook"), null);
  assert.ok(validateWebhookUrl("not a url"));
  assert.ok(validateWebhookUrl("file:///etc/passwd"));
  assert.ok(validateWebhookUrl("ftp://host/hook"));
});

test("Discord URLs get {content} with mentions suppressed; generic endpoints get the structured event", () => {
  assert.equal(isDiscordWebhook(DISCORD), true);
  assert.equal(isDiscordWebhook("https://discordapp.com/api/webhooks/1/a"), true);
  assert.equal(isDiscordWebhook("https://example.com/api/webhooks/1/a"), false);
  const discord = JSON.parse(buildWebhookBody(DISCORD, { kind: "crash", serverName: "Palserver", detail: "exit code 1" }));
  assert.ok(discord.content.includes("Server Hub"));
  assert.ok(discord.content.includes("Palserver"));
  assert.ok(discord.content.includes("exit code 1"));
  assert.deepEqual(discord.allowed_mentions, { parse: [] });
  const generic = JSON.parse(buildWebhookBody("https://example.com/hook", { kind: "backup-complete", serverName: "World", detail: "nightly, 42 MB" }, new Date("2026-09-30T16:00:00Z")));
  assert.equal(generic.source, "serverhub");
  assert.equal(generic.kind, "backup-complete");
  assert.equal(generic.server, "World");
  assert.equal(generic.detail, "nightly, 42 MB");
  assert.equal(generic.at, "2026-09-30T16:00:00.000Z");
});

test("config round-trips through the 0600 file and unknown content falls back to defaults", async () => {
  assert.deepEqual(await readNotificationConfig(), DEFAULT_NOTIFICATION_CONFIG, "missing file yields defaults");
  const config = { url: DISCORD, events: { status: false, crash: true, backup: true } };
  await writeNotificationConfig(config);
  assert.deepEqual(await readNotificationConfig(), config);
  const file = path.join(process.env.SERVERHUB_APPDATA!, "notifications.json");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.writeFileSync(file, "{corrupted");
  assert.deepEqual(await readNotificationConfig(), DEFAULT_NOTIFICATION_CONFIG, "corrupt file yields defaults");
  await assert.rejects(() => writeNotificationConfig({ url: "nope", events: config.events }), /not a valid URL/);
});

test("delivery is a bounded POST that reports failure instead of throwing", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const okFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return { ok: true } as Response;
  }) as typeof fetch;
  const config = { url: DISCORD, events: { status: true, crash: true, backup: true } };
  assert.equal(await deliverNotification(config, { kind: "test", serverName: "Server Hub" }, okFetch), true);
  assert.equal(calls[0].url, DISCORD);
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  const failFetch = (async () => ({ ok: false }) as Response) as typeof fetch;
  assert.equal(await deliverNotification(config, { kind: "test", serverName: "x" }, failFetch), false);
  const throwFetch = (async () => {
    throw new Error("refused");
  }) as typeof fetch;
  assert.equal(await deliverNotification(config, { kind: "test", serverName: "x" }, throwFetch), false);
  const muted = { ...config, events: { status: false, crash: false, backup: false } };
  assert.equal(await deliverNotification(muted, { kind: "crash", serverName: "x" }, okFetch), false, "muted groups never call fetch");
});

test("the runtime emits notifications at every lifecycle point, fire-and-forget", () => {
  const runtime = fs.readFileSync("src/lib/runtime.ts", "utf8");
  for (const kind of ["online", "offline", "crash", "auto-restart", "restart-limit", "backup-complete", "backup-failed", "guardrail"]) {
    assert.ok(runtime.includes(`kind: "${kind}"`), `runtime emits ${kind}`);
  }
  assert.ok(!/await notify\(/.test(runtime), "notify is never awaited in the runtime hot path");
  console.log("NOTIFICATIONS_SUITE_OK");
});
