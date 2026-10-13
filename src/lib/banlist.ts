// Ban-list manager core for Minecraft Java servers: banned-players.json
// and banned-ips.json, the two roster files the whitelist/ops manager
// deliberately left alone. The moderation buttons on the players page
// can already ban whoever the panel has SEEN — this layer makes the ban
// lists themselves first-class: see every ban (including players the
// panel never met), pardon while the server is offline, and manage IP
// bans, which previously had no UI at all. Pure helpers only; the route
// owns the console and the filesystem.

export type BanEntry = {
  uuid: string;
  name: string;
  created: string;
  source: string;
  expires: string;
  reason: string;
};

export type IpBanEntry = {
  ip: string;
  created: string;
  source: string;
  expires: string;
  reason: string;
};

export type BanlistAction = "ban" | "pardon" | "ban-ip" | "pardon-ip";

export const BANLIST_ACTIONS: readonly BanlistAction[] = ["ban", "pardon", "ban-ip", "pardon-ip"];

export const DEFAULT_BAN_REASON = "Banned by an operator.";

/** Vanilla writes "yyyy-MM-dd HH:mm:ss Z"; matching it keeps our entries
 *  indistinguishable from the game's own. Always rendered in UTC. */
export function formatBanDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} +0000`;
}

/** IPv4, or a pragmatic IPv6 shape (hex segments and colons). */
export function validBanIp(ip: string): boolean {
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip)) {
    return ip.split(".").every((part) => Number(part) <= 255);
  }
  return /^[0-9A-Fa-f:]{2,45}$/.test(ip) && ip.includes(":");
}

/** Defensive parse of banned-players.json: keep only entries with a name. */
export function parseBanList(text: string | null): BanEntry[] {
  return parseEntries<BanEntry>(text, (entry) => typeof entry.name === "string");
}

/** Defensive parse of banned-ips.json: keep only entries with an ip. */
export function parseIpBanList(text: string | null): IpBanEntry[] {
  return parseEntries<IpBanEntry>(text, (entry) => typeof entry.ip === "string");
}

function parseEntries<T>(text: string | null, keep: (entry: Record<string, unknown>) => boolean): T[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is T => Boolean(entry) && typeof entry === "object" && keep(entry as Record<string, unknown>));
  } catch {
    return [];
  }
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function upsertBan(
  list: BanEntry[],
  name: string,
  uuid: string,
  reason: string,
  now = new Date()
): { list: BanEntry[]; changed: boolean } {
  if (list.some((entry) => sameName(entry.name, name))) return { list, changed: false };
  const entry: BanEntry = {
    uuid,
    name,
    created: formatBanDate(now),
    source: "ServerHub",
    expires: "forever",
    reason: reason.trim() || DEFAULT_BAN_REASON,
  };
  return { list: [...list, entry], changed: true };
}

export function removeBan(list: BanEntry[], name: string): { list: BanEntry[]; changed: boolean } {
  const next = list.filter((entry) => !sameName(entry.name, name));
  return { list: next, changed: next.length !== list.length };
}

export function upsertIpBan(list: IpBanEntry[], ip: string, reason: string, now = new Date()): { list: IpBanEntry[]; changed: boolean } {
  if (list.some((entry) => entry.ip === ip)) return { list, changed: false };
  const entry: IpBanEntry = {
    ip,
    created: formatBanDate(now),
    source: "ServerHub",
    expires: "forever",
    reason: reason.trim() || DEFAULT_BAN_REASON,
  };
  return { list: [...list, entry], changed: true };
}

export function removeIpBan(list: IpBanEntry[], ip: string): { list: IpBanEntry[]; changed: boolean } {
  const next = list.filter((entry) => entry.ip !== ip);
  return { list: next, changed: next.length !== list.length };
}

/** Console command for a ban action when the server is running. */
export function banlistCommand(action: BanlistAction, target: string, reason?: string): string {
  const cleanReason = (reason ?? "").trim();
  switch (action) {
    case "ban":
      return `ban ${target}${cleanReason ? ` ${cleanReason}` : ""}`;
    case "pardon":
      return `pardon ${target}`;
    case "ban-ip":
      return `ban-ip ${target}${cleanReason ? ` ${cleanReason}` : ""}`;
    case "pardon-ip":
      return `pardon-ip ${target}`;
  }
}
