// Outbound webhook notifications (Discord-compatible). Configuration
// lives in a 0600 JSON file under the app-data directory — deliberately
// outside the database (no schema change) and outside the support-bundle
// allowlist, because Discord webhook URLs embed a capability token.
// Delivery is always bounded and best-effort: a dead webhook must never
// slow down or break server management.

import fsp from "node:fs/promises";
import path from "node:path";
import { MAX_DELIVERY_HISTORY, appendDelivery, normalizeDeliveryHistory, redactWebhookTarget, type DeliveryRecord } from "./notification-history";
import { appDataDir } from "./storage";

export type NotificationEventKind =
  | "crash"
  | "auto-restart"
  | "restart-limit"
  | "guardrail"
  | "online"
  | "offline"
  | "backup-complete"
  | "backup-failed"
  | "mirror-failed"
  | "backup-corrupt"
  | "disk-low"
  | "digest"
  | "test";

export type NotificationEvent = { kind: NotificationEventKind; serverName: string; detail?: string };

export type NotificationConfig = {
  url: string;
  events: { status: boolean; crash: boolean; backup: boolean };
  /** Activity digest settings; absent in configs written before v2.39. */
  digest?: { enabled: boolean; cadence: "daily" | "weekly"; hour: number };
  /** Webhook body format; absent means "auto" (and in configs before v2.63). */
  format?: WebhookFormat;
};

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  url: "",
  events: { status: true, crash: true, backup: true },
};

// Toggle groups: status = online/offline, crash = crashes and the
// watchdog's responses, backup = snapshot outcomes. Tests always fire.
export function notificationGroup(kind: NotificationEventKind): "status" | "crash" | "backup" | "always" {
  if (kind === "online" || kind === "offline") return "status";
  if (kind === "crash" || kind === "auto-restart" || kind === "restart-limit" || kind === "guardrail") return "crash";
  if (kind === "backup-complete" || kind === "backup-failed" || kind === "mirror-failed" || kind === "backup-corrupt") return "backup";
  return "always";
}

export function shouldNotify(config: NotificationConfig, kind: NotificationEventKind): boolean {
  if (!config.url) return false;
  const group = notificationGroup(kind);
  return group === "always" ? true : config.events[group];
}

// Returns an error message, or null when the URL is acceptable. An empty
// URL is valid — it simply disables notifications.
export function validateWebhookUrl(url: string): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "The webhook URL is not a valid URL.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "Only http(s) webhook URLs are supported.";
  return null;
}

export function isDiscordWebhook(url: string): boolean {
  return /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//.test(url);
}

// ---------------------------------------------------------------------------
// Webhook formats. "auto" keeps the pre-v2.63 behavior: Discord webhooks get
// Discord bodies, Slack webhooks get Slack bodies ({text} — Slack rejects
// payloads without it as invalid_payload), everything else gets the generic
// JSON document. An explicit format wins, for Discord/Slack-compatible
// endpoints living on other hostnames (Mattermost, ntfy bridges, proxies).
// ---------------------------------------------------------------------------

export type WebhookFormat = "auto" | "discord" | "slack" | "json";

export const WEBHOOK_FORMATS: readonly WebhookFormat[] = ["auto", "discord", "slack", "json"];

export function isSlackWebhook(url: string): boolean {
  return /^https:\/\/hooks\.slack\.com\//.test(url);
}

export function resolveWebhookFormat(url: string, format: WebhookFormat = "auto"): Exclude<WebhookFormat, "auto"> {
  if (format !== "auto") return format;
  if (isDiscordWebhook(url)) return "discord";
  if (isSlackWebhook(url)) return "slack";
  return "json";
}

const EVENT_TEXT: Record<NotificationEventKind, (name: string, detail: string) => string> = {
  crash: (name, detail) => `🔥 **${name}** crashed unexpectedly${detail ? ` (${detail})` : ""}.`,
  "auto-restart": (name, detail) => `♻️ **${name}**: automatic restart scheduled${detail ? ` — ${detail}` : ""}.`,
  "restart-limit": (name) => `🛑 **${name}**: automatic restart limit reached — manual intervention required.`,
  guardrail: (name, detail) => `📈 **${name}**: resource guardrail triggered${detail ? ` — ${detail}` : ""}.`,
  online: (name) => `✅ **${name}** is online.`,
  offline: (name) => `⏹️ **${name}** stopped.`,
  "backup-complete": (name, detail) => `💾 Backup completed on **${name}**${detail ? ` (${detail})` : ""}.`,
  "backup-failed": (name, detail) => `⚠️ Backup FAILED on **${name}**${detail ? `: ${detail}` : ""}.`,
  "mirror-failed": (name, detail) => `🪞 Backup mirror FAILED on **${name}**${detail ? `: ${detail}` : ""}.`,
  "backup-corrupt": (name, detail) => `🧨 Backup verification FAILED on **${name}**${detail ? `: ${detail}` : ""}.`,
  "disk-low": (name, detail) => `💽 **${name}**: disk space is low${detail ? ` — ${detail}` : ""}.`,
  digest: (_name, detail) => detail,
  test: () => "👋 Test notification — Server Hub webhooks are working.",
};

// Discord expects {content}; anything else receives the structured event.
// Mentions are always suppressed so log text can never ping @everyone.
export function buildWebhookBody(url: string, event: NotificationEvent, now = new Date(), format: WebhookFormat = "auto"): string {
  const text = EVENT_TEXT[event.kind](event.serverName, event.detail ?? "");
  const resolved = resolveWebhookFormat(url, format);
  if (resolved === "discord") {
    return JSON.stringify({ content: `**Server Hub** · ${text}`, allowed_mentions: { parse: [] } });
  }
  if (resolved === "slack") {
    // Slack bolds with single asterisks and requires a text field.
    return JSON.stringify({ text: `Server Hub · ${text.replaceAll("**", "*")}` });
  }
  return JSON.stringify({
    source: "serverhub",
    kind: event.kind,
    server: event.serverName,
    detail: event.detail ?? "",
    text,
    at: now.toISOString(),
  });
}

function configFile() {
  return path.join(appDataDir(), "notifications.json");
}

export async function readNotificationConfig(): Promise<NotificationConfig> {
  try {
    const raw = JSON.parse(await fsp.readFile(configFile(), "utf8")) as Partial<NotificationConfig>;
    return {
      url: typeof raw.url === "string" ? raw.url : "",
      events: {
        status: raw.events?.status !== false,
        crash: raw.events?.crash !== false,
        backup: raw.events?.backup !== false,
      },
      // Keep pre-v2.39 configs byte-identical on round-trip: only carry the
      // digest block when the file actually has one.
      ...(raw.digest !== undefined ? { digest: raw.digest } : {}),
      // Same discipline for the format: only carry a real, non-default value.
      ...(typeof raw.format === "string" && raw.format !== "auto" && WEBHOOK_FORMATS.includes(raw.format as WebhookFormat)
        ? { format: raw.format as WebhookFormat }
        : {}),
    };
  } catch {
    return structuredClone(DEFAULT_NOTIFICATION_CONFIG);
  }
}

export async function writeNotificationConfig(config: NotificationConfig): Promise<void> {
  const problem = validateWebhookUrl(config.url);
  if (problem) throw new Error(problem);
  await fsp.mkdir(appDataDir(), { recursive: true });
  await fsp.writeFile(configFile(), JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  cachedConfig = null;
}

export type DeliveryOutcome = {
  sent: boolean;
  /** True when the event was muted or unconfigured — no attempt was made. */
  skipped: boolean;
  status: number;
  error: string;
  durationMs: number;
};

/** One bounded webhook attempt with the full outcome — no recording here. */
export async function attemptDelivery(
  config: NotificationConfig,
  event: NotificationEvent,
  fetchImpl: typeof fetch = fetch
): Promise<DeliveryOutcome> {
  if (!shouldNotify(config, event.kind)) return { sent: false, skipped: true, status: 0, error: "", durationMs: 0 };
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildWebhookBody(config.url, event, new Date(), config.format ?? "auto"),
      signal: AbortSignal.timeout(5000),
    });
    return { sent: response.ok, skipped: false, status: response.status, error: "", durationMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sent: false, skipped: false, status: 0, error: message.slice(0, 200), durationMs: Date.now() - startedAt };
  }
}

export async function deliverNotification(
  config: NotificationConfig,
  event: NotificationEvent,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  return (await attemptDelivery(config, event, fetchImpl)).sent;
}

// ---------------------------------------------------------------------------
// Delivery history — ring buffer in an app-data sidecar (notification-history.ts)
// ---------------------------------------------------------------------------

function historyFile() {
  return path.join(appDataDir(), "notification-history.json");
}

export async function readDeliveryHistory(): Promise<DeliveryRecord[]> {
  try { return normalizeDeliveryHistory(JSON.parse(await fsp.readFile(historyFile(), "utf8"))); }
  catch { return []; }
}

async function recordDelivery(record: DeliveryRecord): Promise<void> {
  const history = appendDelivery(await readDeliveryHistory(), record, MAX_DELIVERY_HISTORY);
  await fsp.mkdir(appDataDir(), { recursive: true });
  await fsp.writeFile(historyFile(), JSON.stringify(history), "utf8");
}

/** Attempt + record: every real attempt lands in the history, muted events do not. */
export async function deliverAndRecord(
  config: NotificationConfig,
  event: NotificationEvent,
  fetchImpl: typeof fetch = fetch
): Promise<DeliveryOutcome> {
  const outcome = await attemptDelivery(config, event, fetchImpl);
  if (!outcome.skipped) {
    await recordDelivery({
      at: new Date().toISOString(),
      kind: event.kind,
      server: event.serverName,
      ok: outcome.sent,
      status: outcome.status,
      error: outcome.error,
      durationMs: outcome.durationMs,
      target: redactWebhookTarget(config.url),
    }).catch(() => {});
  }
  return outcome;
}

// Runtime-facing fire-and-forget entry point with a short config cache so
// bursts of events (a fleet stopping) do not re-read the file each time.
let cachedConfig: { at: number; config: NotificationConfig } | null = null;

export async function notify(event: NotificationEvent): Promise<void> {
  try {
    if (!cachedConfig || Date.now() - cachedConfig.at > 15_000) {
      cachedConfig = { at: Date.now(), config: await readNotificationConfig() };
    }
    await deliverAndRecord(cachedConfig.config, event);
  } catch {
    /* notifications never interfere with server management */
  }
}
