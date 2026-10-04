// Full-history console search and log export. The live console keeps its
// lightweight client-side filter (console-filter.ts); this module powers
// the server-side search across *all* stored lines — text or regex, level
// and source filters, date range, cursor pagination — and the plain-text
// .log export. Pure logic; the API route owns the SQL.

export const SEARCH_LEVELS = ["info", "warn", "error", "command", "system"] as const;

export const DEFAULT_SEARCH_LIMIT = 50;
export const MAX_SEARCH_LIMIT = 200;
/** Rows examined per request before the search reports a continuation cursor. */
export const MAX_SCAN_ROWS = 5000;
/** Hard cap for a single .log export. */
export const EXPORT_MAX_LINES = 20_000;
export const MAX_QUERY_LENGTH = 200;

export type SearchParams = {
  q: string;
  regex: boolean;
  levels: string[];
  source: string;
  fromMs: number | null;
  toMs: number | null;
  limit: number;
  cursor: number | null;
};

export type SearchLine = { id: number; ts: string; level: string; source: string; message: string };

function parseWhen(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value);
  const ms = Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function normalizeSearchParams(raw: {
  q?: string | null;
  regex?: string | null;
  levels?: string | null;
  source?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: string | null;
  cursor?: string | null;
}): SearchParams {
  const q = (raw.q ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const levels = (raw.levels ?? "")
    .split(",")
    .map((piece) => piece.trim().toLowerCase())
    .filter((piece): piece is (typeof SEARCH_LEVELS)[number] => (SEARCH_LEVELS as readonly string[]).includes(piece));
  let fromMs = parseWhen(raw.from ?? null);
  let toMs = parseWhen(raw.to ?? null);
  if (fromMs !== null && toMs !== null && fromMs > toMs) [fromMs, toMs] = [toMs, fromMs];
  const limitRaw = Number(raw.limit);
  const cursorRaw = Number(raw.cursor);
  return {
    q,
    regex: raw.regex === "1" || raw.regex === "true",
    levels: [...new Set(levels)],
    source: (raw.source ?? "").trim().slice(0, 40),
    fromMs,
    toMs,
    limit: Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= MAX_SEARCH_LIMIT ? limitRaw : DEFAULT_SEARCH_LIMIT,
    cursor: Number.isInteger(cursorRaw) && cursorRaw > 0 ? cursorRaw : null,
  };
}

export type Matcher = { ok: true; test: (line: { level: string; source: string; message: string }) => boolean } | { ok: false; problem: string };

export function compileMatcher(params: SearchParams): Matcher {
  let pattern: RegExp | null = null;
  if (params.regex) {
    if (!params.q) return { ok: false, problem: "A regex search needs a pattern" };
    try {
      pattern = new RegExp(params.q, "i");
    } catch (error) {
      return { ok: false, problem: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const needle = params.q.toLowerCase();
  const source = params.source.toLowerCase();
  const levels = params.levels;
  return {
    ok: true,
    test: (line) => {
      if (levels.length > 0 && !levels.includes(line.level)) return false;
      if (source && !line.source.toLowerCase().includes(source)) return false;
      if (pattern) return pattern.test(line.message);
      if (needle) return line.message.toLowerCase().includes(needle);
      return true;
    },
  };
}

/**
 * Walk pre-filtered candidate rows (newest first) through the matcher.
 * Stops at `limit` matches or when the scan budget is exhausted; the
 * caller resumes from `lastExaminedId`.
 */
export function collectMatches<T extends { id: number; level: string; source: string; message: string }>(
  rows: T[],
  matcher: Extract<Matcher, { ok: true }>,
  limit: number,
  scanBudget: number
): { matched: T[]; scanned: number; lastExaminedId: number | null; exhaustedBudget: boolean } {
  const matched: T[] = [];
  let scanned = 0;
  let lastExaminedId: number | null = null;
  for (const row of rows) {
    if (matched.length >= limit || scanned >= scanBudget) break;
    scanned++;
    lastExaminedId = row.id;
    if (matcher.test(row)) matched.push(row);
  }
  return { matched, scanned, lastExaminedId, exhaustedBudget: scanned >= scanBudget && matched.length < limit };
}

/** One exported line: ISO timestamp, aligned level, source, message. */
export function formatLogLine(line: { ts: string | Date; level: string; source: string; message: string }): string {
  const iso = typeof line.ts === "string" ? line.ts : line.ts.toISOString();
  return `${iso} [${line.level.padEnd(7)}] [${line.source}] ${line.message}`;
}

export function exportFileName(serverName: string, now: Date = new Date()): string {
  const slug = serverName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "server";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${slug}-console-${stamp}.log`;
}
