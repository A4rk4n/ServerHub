import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backups, servers } from "@/db/schema";
import { compareBackupToLive } from "@/lib/backup-diff";
import { PREVIEW_MAX_BYTES, isProbablyTextEntry, readBackupEntry, sanitizeArchiveEntryPath } from "@/lib/backup-browser";
import { backupArchivePath } from "@/lib/runtime";
import { serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string; bid: string }> }) {
  const { id, bid } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [backup] = await db.select().from(backups).where(and(eq(backups.id, Number(bid)), eq(backups.serverId, server.id)));
  if (!backup || backup.status !== "complete") return NextResponse.json({ error: "Backup is unavailable" }, { status: 404 });
  const archive = backupArchivePath(backup);
  if (!fs.existsSync(archive)) return NextResponse.json({ error: "Backup archive is missing from disk" }, { status: 404 });

  const entryPath = sanitizeArchiveEntryPath(new URL(request.url).searchParams.get("path") ?? "");
  if (!entryPath) return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  if (!isProbablyTextEntry(entryPath)) return NextResponse.json({ error: "This file type cannot be compared as text" }, { status: 415 });

  const buffer = await readBackupEntry(archive, entryPath, PREVIEW_MAX_BYTES);
  if (!buffer) return NextResponse.json({ error: "That file is not in this backup (or is too large to compare)" }, { status: 404 });

  // The live copy: resolve inside the server directory only.
  const root = path.resolve(serverDir(server));
  const livePath = path.resolve(root, entryPath);
  if (livePath !== root && !livePath.startsWith(root + path.sep)) return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  let liveText: string | null = null;
  try {
    const stat = await fsp.stat(livePath);
    if (!stat.isFile()) return NextResponse.json({ error: "The live path is not a regular file" }, { status: 409 });
    if (stat.size > PREVIEW_MAX_BYTES) return NextResponse.json({ error: "The live file is too large to compare as text" }, { status: 413 });
    liveText = await fsp.readFile(livePath, "utf8");
  } catch {
    liveText = null; // deleted since the backup — a first-class answer, not an error
  }

  const comparison = compareBackupToLive(buffer.toString("utf8"), liveText);
  return NextResponse.json({ path: entryPath, ...comparison });
}
