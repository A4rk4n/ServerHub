// Whitelist & ops manager core for Minecraft Java servers. Pure helpers for
// roster file manipulation, server.properties whitelist toggling, offline
// UUID derivation, and console-command mapping. Server-side only (uses
// node:crypto for the offline UUID).

import { createHash } from "node:crypto";

export type WhitelistEntry = { uuid: string; name: string };
export type OpsEntry = { uuid: string; name: string; level: number; bypassesPlayerLimit: boolean };

export type RosterAction = "whitelist-add" | "whitelist-remove" | "op" | "deop" | "whitelist-on" | "whitelist-off";

export const ROSTER_ACTIONS: readonly RosterAction[] = [
  "whitelist-add",
  "whitelist-remove",
  "op",
  "deop",
  "whitelist-on",
  "whitelist-off",
];

export const DEFAULT_OP_LEVEL = 4;

/** Only Minecraft Java edition servers use whitelist.json / ops.json. */
export function isMinecraftJava(gameId: string): boolean {
  return gameId === "minecraft" || gameId === "minecraft-modded";
}

/** Valid Java edition account name: 3–16 letters, digits, underscores. */
export function validMinecraftName(name: string): boolean {
  return /^[A-Za-z0-9_]{3,16}$/.test(name);
}

/**
 * Offline-mode UUID, exactly as the vanilla server derives it:
 * Java's UUID.nameUUIDFromBytes(md5("OfflinePlayer:" + name)) — a v3 UUID.
 * Online-mode servers use Mojang account UUIDs instead; entries written
 * offline are authoritative for offline-mode servers and are corrected by
 * the live console path otherwise.
 */
export function offlineUuid(name: string): string {
  const digest = createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest();
  digest[6] = (digest[6] & 0x0f) | 0x30; // version 3
  digest[8] = (digest[8] & 0x3f) | 0x80; // IETF variant
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Parse a whitelist.json / ops.json payload defensively. */
export function parseRosterFile<T extends { name?: unknown }>(text: string | null): T[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is T => Boolean(entry) && typeof entry === "object" && typeof entry.name === "string");
  } catch {
    return [];
  }
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function upsertWhitelist(list: WhitelistEntry[], name: string, uuid: string): { list: WhitelistEntry[]; changed: boolean } {
  if (list.some((entry) => sameName(entry.name, name))) return { list, changed: false };
  return { list: [...list, { uuid, name }], changed: true };
}

export function removeWhitelist(list: WhitelistEntry[], name: string): { list: WhitelistEntry[]; changed: boolean } {
  const next = list.filter((entry) => !sameName(entry.name, name));
  return { list: next, changed: next.length !== list.length };
}

export function upsertOp(
  list: OpsEntry[],
  name: string,
  uuid: string,
  level: number = DEFAULT_OP_LEVEL
): { list: OpsEntry[]; changed: boolean } {
  const existing = list.find((entry) => sameName(entry.name, name));
  if (existing) {
    if (existing.level === level) return { list, changed: false };
    return { list: list.map((entry) => (sameName(entry.name, name) ? { ...entry, level } : entry)), changed: true };
  }
  return { list: [...list, { uuid, name, level, bypassesPlayerLimit: false }], changed: true };
}

export function removeOp(list: OpsEntry[], name: string): { list: OpsEntry[]; changed: boolean } {
  const next = list.filter((entry) => !sameName(entry.name, name));
  return { list: next, changed: next.length !== list.length };
}

/** Read white-list= from server.properties. null when the key is absent. */
export function readWhitelistEnabled(propertiesText: string | null): boolean | null {
  if (propertiesText === null) return null;
  const match = propertiesText.match(/^[ \t]*white-list[ \t]*=[ \t]*(.*?)[ \t\r]*$/m);
  if (!match) return null;
  return match[1].toLowerCase() === "true";
}

/** Set (or append) white-list= in server.properties, preserving everything else. */
export function setWhitelistEnabled(propertiesText: string | null, enabled: boolean): string {
  const value = `white-list=${enabled}`;
  const text = propertiesText ?? "";
  if (/^[ \t]*white-list[ \t]*=.*$/m.test(text)) {
    return text.replace(/^[ \t]*white-list[ \t]*=.*$/m, value);
  }
  const body = text.length && !text.endsWith("\n") ? `${text}\n` : text;
  return `${body}${value}\n`;
}

/** Console command(s) for a roster action when the server is running. */
export function rosterCommands(action: RosterAction, name?: string): string[] {
  switch (action) {
    case "whitelist-add":
      return [`whitelist add ${name}`];
    case "whitelist-remove":
      return [`whitelist remove ${name}`];
    case "op":
      return [`op ${name}`];
    case "deop":
      return [`deop ${name}`];
    case "whitelist-on":
      return ["whitelist on"];
    case "whitelist-off":
      return ["whitelist off"];
  }
}

/** Whether an action needs a player name. */
export function actionNeedsName(action: RosterAction): boolean {
  return action !== "whitelist-on" && action !== "whitelist-off";
}
