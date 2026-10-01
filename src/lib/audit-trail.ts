// Unified audit trail: one filterable timeline across everything the
// panel already records — activity (power, file edits with safety-copy
// references, backups, exports, roster), task runs, moderation actions,
// and PIN unlock attempts — plus CSV export. Pure logic only; the API
// route owns the SQL and merges bounded slices of each source here.

export const AUDIT_CATEGORIES = ["power", "files", "backups", "roster", "tasks", "security", "other"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export type AuditEvent = {
  at: string;
  category: AuditCategory;
  serverId: number | null;
  serverName: string;
  summary: string;
  detail: string;
};

export const DEFAULT_AUDIT_LIMIT = 50;
export const MAX_AUDIT_LIMIT = 200;
/** Rows pulled from each source table per request before merging. */
export const AUDIT_SOURCE_ROWS = 2000;
/** Hard cap for a single CSV export. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

/** Map an activity row's kind (and message, for the overloaded "settings" kind) to a category. */
export function categorizeActivity(kind: string, message: string): AuditCategory {
  switch (kind) {
    case "power":
    case "stopped":
    case "cancelled":
    case "crashed":
    case "guardrail":
      return "power";
    case "backup":
      return "backups";
    case "task":
      return "tasks";
    case "player":
      return "roster";
    case "security":
      return "security";
    case "settings":
      return /^File .+ saved|Export bundle/.test(message) ? "files" : "other";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// Building the merged timeline
// ---------------------------------------------------------------------------

type DateInput = Date | string | number | null;

function toIso(value: DateInput): string {
  const date = value instanceof Date ? value : new Date(value ?? 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

export type AuditSources = {
  activity: Array<{ serverId: number | null; kind: string; message: string; ts: DateInput }>;
  taskRuns: Array<{ serverId: number; taskName: string; type: string; status: string; error: string; createdAt: DateInput }>;
  moderation: Array<{ serverId: number; action: string; target: string; reason: string; status: string; createdAt: DateInput }>;
  serverNames: Map<number, string>;
};

/** Merge all sources into one newest-first timeline. */
export function buildAuditEvents(sources: AuditSources): AuditEvent[] {
  const nameOf = (serverId: number | null): string =>
    serverId === null ? "Panel" : sources.serverNames.get(serverId) ?? `server ${serverId}`;
  const events: AuditEvent[] = [];
  for (const row of sources.activity) {
    events.push({
      at: toIso(row.ts),
      category: categorizeActivity(row.kind, row.message),
      serverId: row.serverId,
      serverName: nameOf(row.serverId),
      summary: row.message,
      detail: row.kind,
    });
  }
  for (const row of sources.taskRuns) {
    events.push({
      at: toIso(row.createdAt),
      category: "tasks",
      serverId: row.serverId,
      serverName: nameOf(row.serverId),
      summary: `Task "${row.taskName}" ${row.status}`,
      detail: [row.type, row.error].filter(Boolean).join(" — "),
    });
  }
  for (const row of sources.moderation) {
    events.push({
      at: toIso(row.createdAt),
      category: "roster",
      serverId: row.serverId,
      serverName: nameOf(row.serverId),
      summary: `${row.action} ${row.target}`.trim(),
      detail: [row.status, row.reason].filter(Boolean).join(" — "),
    });
  }
  events.sort((a, b) => b.at.localeCompare(a.at) || a.summary.localeCompare(b.summary));
  return events;
}

// ---------------------------------------------------------------------------
// Filters & pagination
// ---------------------------------------------------------------------------

export type AuditFilters = {
  categories: AuditCategory[];
  serverId: number | null;
  q: string;
  fromMs: number | null;
  toMs: number | null;
  limit: number;
  offset: number;
};

function parseWhen(value: string | null | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value);
  const ms = Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function normalizeAuditFilters(raw: {
  categories?: string | null;
  serverId?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: string | null;
  offset?: string | null;
}): AuditFilters {
  const categories = [...new Set(
    (raw.categories ?? "")
      .split(",")
      .map((piece) => piece.trim().toLowerCase())
      .filter((piece): piece is AuditCategory => (AUDIT_CATEGORIES as readonly string[]).includes(piece))
  )];
  const serverIdRaw = Number(raw.serverId);
  let fromMs = parseWhen(raw.from);
  let toMs = parseWhen(raw.to);
  if (fromMs !== null && toMs !== null && fromMs > toMs) [fromMs, toMs] = [toMs, fromMs];
  const limitRaw = Number(raw.limit);
  const offsetRaw = Number(raw.offset);
  return {
    categories,
    serverId: Number.isInteger(serverIdRaw) && serverIdRaw > 0 ? serverIdRaw : null,
    q: (raw.q ?? "").trim().slice(0, 100),
    fromMs,
    toMs,
    limit: Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= MAX_AUDIT_LIMIT ? limitRaw : DEFAULT_AUDIT_LIMIT,
    offset: Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0,
  };
}

export function filterAuditEvents(events: AuditEvent[], filters: AuditFilters): AuditEvent[] {
  const needle = filters.q.toLowerCase();
  return events.filter((event) => {
    if (filters.categories.length && !filters.categories.includes(event.category)) return false;
    if (filters.serverId !== null && event.serverId !== filters.serverId) return false;
    const at = Date.parse(event.at);
    if (filters.fromMs !== null && at < filters.fromMs) return false;
    if (filters.toMs !== null && at > filters.toMs) return false;
    if (needle && !`${event.summary}\n${event.detail}\n${event.serverName}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export function paginateAuditEvents(filtered: AuditEvent[], filters: AuditFilters): { events: AuditEvent[]; total: number } {
  return { events: filtered.slice(filters.offset, filters.offset + filters.limit), total: filtered.length };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** RFC-4180-style CSV: CRLF line ends, quoted only where needed. */
export function toAuditCsv(events: AuditEvent[]): string {
  const lines = ["at,category,server,summary,detail"];
  for (const event of events) {
    lines.push([event.at, event.category, event.serverName, event.summary, event.detail].map(csvEscape).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function auditCsvFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `audit-trail-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.csv`;
}
