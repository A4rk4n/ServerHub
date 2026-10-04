// Notification delivery history. Every real webhook attempt (muted events
// are not attempts) is recorded in a small ring buffer — newest first, hard
// cap — so a failing webhook is debuggable from the panel instead of being
// a silent black hole. The webhook URL embeds a capability token, so records
// carry only the target hostname, never the URL.

export type DeliveryRecord = {
  at: string;
  kind: string;
  server: string;
  ok: boolean;
  /** HTTP status of the attempt; 0 means the request itself failed. */
  status: number;
  /** Short transport error when status is 0; empty otherwise. */
  error: string;
  durationMs: number;
  /** Hostname only — the full URL is a secret. */
  target: string;
};

export const MAX_DELIVERY_HISTORY = 50;

/** Hostname only; anything unparseable degrades to a fixed label. */
export function redactWebhookTarget(url: string): string {
  try {
    return new URL(url).hostname || "invalid-url";
  } catch {
    return "invalid-url";
  }
}

function cleanRecord(raw: unknown): DeliveryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== "string" || !Number.isFinite(Date.parse(r.at))) return null;
  if (typeof r.ok !== "boolean") return null;
  return {
    at: r.at,
    kind: typeof r.kind === "string" ? r.kind.slice(0, 40) : "unknown",
    server: typeof r.server === "string" ? r.server.slice(0, 100) : "",
    ok: r.ok,
    status: typeof r.status === "number" && Number.isInteger(r.status) && r.status >= 0 && r.status <= 999 ? r.status : 0,
    error: typeof r.error === "string" ? r.error.slice(0, 200) : "",
    durationMs: typeof r.durationMs === "number" && Number.isFinite(r.durationMs) && r.durationMs >= 0 ? Math.round(r.durationMs) : 0,
    target: typeof r.target === "string" ? r.target.slice(0, 200) : "",
  };
}

/** Corrupt files degrade to an empty history; junk entries are dropped; the cap always holds. */
export function normalizeDeliveryHistory(raw: unknown): DeliveryRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: DeliveryRecord[] = [];
  for (const item of raw) {
    const record = cleanRecord(item);
    if (record) records.push(record);
    if (records.length >= MAX_DELIVERY_HISTORY) break;
  }
  return records;
}

/** Newest first, capped. Returns a new array; never mutates. */
export function appendDelivery(history: DeliveryRecord[], record: DeliveryRecord, max = MAX_DELIVERY_HISTORY): DeliveryRecord[] {
  return [record, ...history].slice(0, Math.max(1, max));
}

export type DeliverySummary = { total: number; failed: number; lastSuccessAt: string | null; lastFailureAt: string | null };

export function summarizeDeliveries(history: DeliveryRecord[]): DeliverySummary {
  const failed = history.filter((record) => !record.ok);
  return {
    total: history.length,
    failed: failed.length,
    lastSuccessAt: history.find((record) => record.ok)?.at ?? null,
    lastFailureAt: failed[0]?.at ?? null,
  };
}
