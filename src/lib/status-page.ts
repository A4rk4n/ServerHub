// Public status page: a read-only, token-guarded snapshot of the fleet
// (up/down, player counts, versions) that can be shared with players
// without exposing the panel. Pure logic only — config shape, token
// generation/comparison, access decisions, and the whitelisted public
// snapshot. The token is a capability: the config file lives outside the
// database and outside the support-bundle allowlist, like webhooks.

import crypto from "node:crypto";

export type StatusPageConfig = {
  enabled: boolean;
  /** URL-safe bearer token; empty means "never generated yet". */
  token: string;
  /** Heading shown on the shared page. */
  title: string;
};

export const DEFAULT_STATUS_TITLE = "Server Status";
export const MAX_STATUS_TITLE_LENGTH = 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function normalizeStatusConfig(raw: unknown): StatusPageConfig {
  if (!raw || typeof raw !== "object") return { enabled: false, token: "", title: DEFAULT_STATUS_TITLE };
  const record = raw as Record<string, unknown>;
  const token = typeof record.token === "string" && TOKEN_PATTERN.test(record.token.trim()) ? record.token.trim() : "";
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, MAX_STATUS_TITLE_LENGTH) : DEFAULT_STATUS_TITLE;
  return { enabled: record.enabled === true && token.length > 0, token, title };
}

/** 24 random bytes as base64url — 32 URL-safe chars. `random` is injectable for tests. */
export function generateStatusToken(random: (bytes: number) => Buffer = crypto.randomBytes): string {
  return random(24).toString("base64url");
}

/** Constant-time token comparison; an empty expected token never matches. */
export function safeTokenEquals(expected: string, provided: string): boolean {
  if (!expected || !provided || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export type StatusAccess = { ok: true } | { ok: false; status: 404 | 401; problem: string };

/** Disabled pages 404 (nothing to probe); enabled pages demand the exact token. */
export function statusAccess(config: StatusPageConfig, providedToken: string): StatusAccess {
  if (!config.enabled || !config.token) return { ok: false, status: 404, problem: "Not found" };
  if (!safeTokenEquals(config.token, providedToken)) return { ok: false, status: 401, problem: "Invalid status token" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public snapshot — whitelist-built, sensitive fields cannot leak
// ---------------------------------------------------------------------------

export type PublicServerStatus = "online" | "offline" | "maintenance";

export function publicStatusLabel(status: string): PublicServerStatus {
  if (status === "online") return "online";
  if (["offline", "crashed", "error"].includes(status)) return "offline";
  return "maintenance";
}

export type StatusSourceRow = {
  name: string;
  gameName: string;
  version: string;
  loader: string;
  status: string;
  maxPlayers: number;
  onlineCount: number;
  lastStartedAt: Date | string | null;
};

export type PublicServerRow = {
  name: string;
  game: string;
  version: string;
  status: PublicServerStatus;
  players: { online: number; max: number };
  uptimeSec: number | null;
};

export type StatusSnapshot = {
  title: string;
  generatedAt: string;
  totals: { servers: number; online: number; players: number };
  servers: PublicServerRow[];
};

/** Build the shared snapshot. Only whitelisted fields are copied — extra input keys can never leak. */
export function buildStatusSnapshot(title: string, rows: StatusSourceRow[], now = new Date()): StatusSnapshot {
  const servers: PublicServerRow[] = rows.map((row) => {
    const status = publicStatusLabel(row.status);
    const started = row.lastStartedAt ? new Date(row.lastStartedAt).getTime() : Number.NaN;
    const uptimeSec = status === "online" && Number.isFinite(started) && started <= now.getTime()
      ? Math.floor((now.getTime() - started) / 1000)
      : null;
    const version = row.loader && row.loader !== "vanilla" ? `${row.version} (${row.loader})` : row.version;
    return {
      name: row.name,
      game: row.gameName,
      version,
      status,
      players: { online: Math.max(0, row.onlineCount), max: Math.max(0, row.maxPlayers) },
      uptimeSec,
    };
  });
  servers.sort((a, b) => a.name.localeCompare(b.name));
  return {
    title,
    generatedAt: now.toISOString(),
    totals: {
      servers: servers.length,
      online: servers.filter((row) => row.status === "online").length,
      players: servers.reduce((sum, row) => sum + row.players.online, 0),
    },
    servers,
  };
}

export function formatUptime(uptimeSec: number): string {
  if (uptimeSec < 60) return `${uptimeSec}s`;
  if (uptimeSec < 3600) return `${Math.floor(uptimeSec / 60)}m`;
  const hours = Math.floor(uptimeSec / 3600);
  if (hours < 48) return `${hours}h ${Math.floor((uptimeSec % 3600) / 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
