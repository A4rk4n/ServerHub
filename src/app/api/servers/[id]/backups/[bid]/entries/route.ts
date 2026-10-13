import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backups } from "@/db/schema";
import {
  ENTRY_DOWNLOAD_MAX_BYTES,
  PREVIEW_MAX_BYTES,
  isProbablyTextEntry,
  listBackupEntries,
  readBackupEntry,
  sanitizeArchiveEntryPath,
} from "@/lib/backup-browser";
import { backupArchivePath } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string; bid: string }> }) {
  const { id, bid } = await ctx.params;
  const [backup] = await db.select().from(backups).where(and(eq(backups.id, Number(bid)), eq(backups.serverId, Number(id))));
  if (!backup || backup.status !== "complete") return NextResponse.json({ error: "Backup is unavailable" }, { status: 404 });
  const archive = backupArchivePath(backup);
  if (!fs.existsSync(archive)) return NextResponse.json({ error: "Backup archive is missing from disk" }, { status: 404 });
  const url = new URL(request.url);
  const rawPath = url.searchParams.get("path");

  try {
    if (!rawPath) {
      const { entries, truncated } = await listBackupEntries(archive);
      return NextResponse.json({ entries, truncated });
    }
    const entryPath = sanitizeArchiveEntryPath(rawPath);
    if (!entryPath) return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    const preview = url.searchParams.get("preview") === "1";
    const buffer = await readBackupEntry(archive, entryPath, preview ? PREVIEW_MAX_BYTES : ENTRY_DOWNLOAD_MAX_BYTES);
    if (buffer === null) return NextResponse.json({ error: "That file is not in this backup" }, { status: 404 });
    if (preview) {
      if (!isProbablyTextEntry(entryPath)) return NextResponse.json({ error: "This file type cannot be previewed as text" }, { status: 415 });
      return NextResponse.json({ path: entryPath, size: buffer.length, text: buffer.toString("utf8") });
    }
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${path.posix.basename(entryPath)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the backup archive" }, { status: 409 });
  }
}
