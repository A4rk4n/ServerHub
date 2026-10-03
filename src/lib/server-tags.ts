// Server tags: lightweight fleet labels ("production", "events", "testing")
// stored in an app-data sidecar — deliberately outside the database so no
// schema migration is needed and exports/imports stay untouched. Tags are
// panel metadata, not server state: the fleet page filters by them, and the
// existing bulk power actions operate on the filtered set, which makes
// "restart everything tagged events" a two-click operation.

import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

export const MAX_TAGS_PER_SERVER = 8;
export const MAX_TAG_LENGTH = 24;

/**
 * Canonical tag form: trimmed, lower-cased, inner whitespace collapsed to
 * single spaces. Only letters, digits, spaces, dashes, and underscores
 * survive — anything else makes the tag invalid (empty string back).
 */
export function normalizeTag(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const tag = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!tag || tag.length > MAX_TAG_LENGTH) return "";
  if (!/^[a-z0-9 _-]+$/.test(tag)) return "";
  return tag;
}

/** Normalized, deduplicated, capped, alphabetical. */
export function normalizeTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const tag = normalizeTag(entry);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS_PER_SERVER) break;
  }
  return [...seen].sort();
}

export function tagCounts(byServer: Record<string, string[]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tags of Object.values(byServer)) {
    for (const tag of tags) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

// ---- app-data sidecar ------------------------------------------------------

function tagsFile(base?: string) {
  return path.join(base ?? appDataDir(), "server-tags.json");
}

export async function readAllServerTags(base?: string): Promise<Record<string, string[]>> {
  try {
    const raw = JSON.parse(await fsp.readFile(tagsFile(base), "utf8")) as Record<string, unknown>;
    const result: Record<string, string[]> = {};
    for (const [id, value] of Object.entries(raw)) {
      const tags = normalizeTagList(value);
      if (tags.length > 0) result[id] = tags;
    }
    return result;
  } catch {
    return {};
  }
}

export async function readServerTags(serverId: number, base?: string): Promise<string[]> {
  const all = await readAllServerTags(base);
  return all[String(serverId)] ?? [];
}

export async function writeServerTags(serverId: number, tags: string[], base?: string): Promise<string[]> {
  const all = await readAllServerTags(base);
  const normalized = normalizeTagList(tags);
  if (normalized.length > 0) all[String(serverId)] = normalized;
  else delete all[String(serverId)];
  const dir = base ?? appDataDir();
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(tagsFile(base), JSON.stringify(all, null, 2), "utf8");
  return normalized;
}
