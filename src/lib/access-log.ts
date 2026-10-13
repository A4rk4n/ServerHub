// Panel access log (F56): a local record of when the panel was used
// and by which browser — visits, lock-screen bounces, PIN unlock
// attempts, and rejected non-loopback requests. The panel is
// loopback-only, so the point is the timeline on a shared PC: "someone
// opened Server Hub at 23:40 and failed the PIN twice". Stored as a
// capped ring in appdata/access-log.json; page visits are deduped to
// one entry per browser per window so browsing the panel does not
// flood the log.

import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

export type AccessKind = "visit" | "locked" | "unlock-ok" | "unlock-fail" | "denied";

export type AccessEvent = {
  ts: number;
  ip: string;
  userAgent: string;
  kind: AccessKind;
  path: string;
};

export const ACCESS_LOG_CAP = 400;
export const VISIT_DEDUPE_MS = 15 * 60 * 1000;

// ---- pure helpers ----------------------------------------------------------

/** Dedupe key for a visit: same browser from the same address. */
export function visitKey(ip: string, userAgent: string): string {
  return `${ip}\u0000${userAgent}`;
}

/**
 * Only "visit" events are deduped — security-relevant events (lock
 * bounces, unlock attempts, boundary rejections) are always recorded.
 * Returns whether to record and the updated last-seen state.
 */
export function shouldRecord(
  kind: AccessKind,
  key: string,
  lastSeen: Record<string, number>,
  now: number,
  windowMs = VISIT_DEDUPE_MS
): { record: boolean; lastSeen: Record<string, number> } {
  if (kind !== "visit") return { record: true, lastSeen };
  const prev = lastSeen[key] ?? 0;
  if (now - prev < windowMs) return { record: false, lastSeen };
  return { record: true, lastSeen: { ...lastSeen, [key]: now } };
}

/** Newest-first, capped. Input order is preserved among equal timestamps. */
export function capEntries(entries: AccessEvent[], cap = ACCESS_LOG_CAP): AccessEvent[] {
  return [...entries].sort((a, b) => b.ts - a.ts).slice(0, cap);
}

/** Human name for a user agent — the log shows "Edge", not 140 chars of UA. */
export function describeAgent(userAgent: string): string {
  const ua = userAgent || "";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Electron\//.test(ua)) return "Server Hub app";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  if (!ua.trim()) return "Unknown client";
  return ua.split("/")[0].slice(0, 24) || "Unknown client";
}

export type AccessSummary = {
  visits24h: number;
  locked24h: number;
  unlockFails24h: number;
  unlockOks24h: number;
  denied24h: number;
  agents24h: string[];
  lastVisit: number | null;
};

export function summarizeAccess(entries: AccessEvent[], now = Date.now()): AccessSummary {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recent = entries.filter((e) => e.ts >= dayAgo);
  const agents = new Set<string>();
  let visits = 0, locked = 0, fails = 0, oks = 0, denied = 0;
  for (const e of recent) {
    agents.add(describeAgent(e.userAgent));
    if (e.kind === "visit") visits += 1;
    else if (e.kind === "locked") locked += 1;
    else if (e.kind === "unlock-fail") fails += 1;
    else if (e.kind === "unlock-ok") oks += 1;
    else if (e.kind === "denied") denied += 1;
  }
  const lastVisit = entries.find((e) => e.kind === "visit")?.ts ?? null;
  return { visits24h: visits, locked24h: locked, unlockFails24h: fails, unlockOks24h: oks, denied24h: denied, agents24h: [...agents].sort(), lastVisit };
}

// ---- persistence -----------------------------------------------------------

export function accessLogFile(base?: string): string {
  return path.join(base ?? appDataDir(), "access-log.json");
}

export async function loadAccessLog(base?: string): Promise<AccessEvent[]> {
  try {
    const raw = JSON.parse(await fsp.readFile(accessLogFile(base), "utf8")) as { entries?: unknown };
    if (!Array.isArray(raw?.entries)) return [];
    return capEntries(
      raw.entries.filter(
        (e): e is AccessEvent =>
          !!e && typeof e === "object" &&
          typeof (e as AccessEvent).ts === "number" &&
          typeof (e as AccessEvent).kind === "string" &&
          typeof (e as AccessEvent).ip === "string" &&
          typeof (e as AccessEvent).userAgent === "string" &&
          typeof (e as AccessEvent).path === "string"
      )
    );
  } catch {
    return [];
  }
}

export async function clearAccessLog(base?: string): Promise<void> {
  await fsp.rm(accessLogFile(base), { force: true });
}

// In-process visit dedupe plus a write chain so concurrent requests
// never interleave writes to the sidecar.
let visitLastSeen: Record<string, number> = {};
let writeChain: Promise<void> = Promise.resolve();

export function resetAccessLogState(): void {
  visitLastSeen = {};
  writeChain = Promise.resolve();
}

/**
 * Best-effort append — never throws, never awaited by the request
 * path. Visit dedupe happens in memory before any disk I/O, so the
 * per-request cost while browsing is a map lookup.
 */
export function recordAccess(event: Omit<AccessEvent, "ts"> & { ts?: number }, base?: string): Promise<void> {
  const ts = event.ts ?? Date.now();
  const verdict = shouldRecord(event.kind, visitKey(event.ip, event.userAgent), visitLastSeen, ts);
  visitLastSeen = verdict.lastSeen;
  if (!verdict.record) return Promise.resolve();
  const entry: AccessEvent = { ts, ip: event.ip, userAgent: event.userAgent.slice(0, 300), kind: event.kind, path: event.path.slice(0, 200) };
  writeChain = writeChain.then(async () => {
    try {
      const entries = capEntries([entry, ...(await loadAccessLog(base))]);
      const file = accessLogFile(base);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, JSON.stringify({ entries }, null, 2), { encoding: "utf8", mode: 0o600 });
    } catch {
      /* best effort — the access log never breaks a request */
    }
  });
  return writeChain;
}

/** Extract the caller address: first X-Forwarded-For hop, else loopback. */
export function callerIp(forwardedFor: string | null): string {
  const first = (forwardedFor ?? "").split(",")[0].trim();
  return first || "127.0.0.1";
}

/** Page visits only: GET documents, not API calls or asset requests. */
export function isVisitPath(pathname: string): boolean {
  return !pathname.startsWith("/api/") && !pathname.startsWith("/_next/") && !pathname.includes(".");
}
