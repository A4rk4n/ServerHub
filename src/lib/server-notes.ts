// Server notes / runbook: free-form per-server text on the Settings
// page — launch quirks, mod install order, "who to ping when it
// breaks", restore steps. Admin knowledge lives next to the server it
// belongs to instead of in someone's head. Stored in an app-data
// sidecar (server-notes.json) like server tags: no schema migration,
// exports untouched, plain text only — never executed or rendered as
// markup.

import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

export const MAX_NOTES_CHARS = 20_000;

export type ServerNotes = { text: string; updatedAt: number };

/**
 * Canonical note form: CRLF folded to LF, trailing whitespace-only
 * tail trimmed. Content is otherwise preserved byte for byte — notes
 * are the operator's words, not ours to reformat.
 */
export function normalizeNotes(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  if (text.length > MAX_NOTES_CHARS) return null;
  return text;
}

/** First non-empty line, ellipsized — for compact previews. */
export function notesPreview(text: string, max = 80): string {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---- app-data sidecar ------------------------------------------------------

export function notesFile(base?: string): string {
  return path.join(base ?? appDataDir(), "server-notes.json");
}

function validEntry(value: unknown): value is ServerNotes {
  return (
    !!value && typeof value === "object" &&
    typeof (value as ServerNotes).text === "string" &&
    typeof (value as ServerNotes).updatedAt === "number"
  );
}

export async function readAllServerNotes(base?: string): Promise<Record<string, ServerNotes>> {
  try {
    const raw = JSON.parse(await fsp.readFile(notesFile(base), "utf8")) as Record<string, unknown>;
    const result: Record<string, ServerNotes> = {};
    for (const [id, value] of Object.entries(raw)) {
      if (validEntry(value) && value.text.length > 0 && value.text.length <= MAX_NOTES_CHARS) result[id] = { text: value.text, updatedAt: value.updatedAt };
    }
    return result;
  } catch {
    return {};
  }
}

export async function readServerNotes(serverId: number, base?: string): Promise<ServerNotes | null> {
  const all = await readAllServerNotes(base);
  return all[String(serverId)] ?? null;
}

/** Empty text deletes the entry — the sidecar only holds real notes. */
export async function writeServerNotes(serverId: number, text: string, base?: string, now = Date.now()): Promise<ServerNotes | null> {
  const all = await readAllServerNotes(base);
  const key = String(serverId);
  let entry: ServerNotes | null = null;
  if (text.length === 0) {
    delete all[key];
  } else {
    entry = { text, updatedAt: now };
    all[key] = entry;
  }
  const file = notesFile(base);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(all, null, 2), "utf8");
  return entry;
}

/** Called when a server is deleted so the sidecar never hoards ghosts. */
export async function deleteServerNotes(serverId: number, base?: string): Promise<void> {
  const all = await readAllServerNotes(base);
  if (!(String(serverId) in all)) return;
  delete all[String(serverId)];
  await fsp.writeFile(notesFile(base), JSON.stringify(all, null, 2), "utf8").catch(() => {});
}
