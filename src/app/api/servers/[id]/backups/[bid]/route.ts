import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { backups, servers } from "@/db/schema";
import { act, backupArchivePath, deleteBackupFile, restoreBackup } from "@/lib/runtime";
import { safeFileName } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; bid: string }> };

async function load(ctx: Context) {
  const { id, bid } = await ctx.params;
  const [backup] = await db.select().from(backups).where(and(eq(backups.id, Number(bid)), eq(backups.serverId, Number(id))));
  return { id: Number(id), bid: Number(bid), backup };
}

export async function GET(_req: Request, ctx: Context) {
  const { backup } = await load(ctx);
  if (!backup) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const archive = backupArchivePath(backup);
  if (!fs.existsSync(archive) || backup.status !== "complete") return NextResponse.json({ error: "Archive is unavailable" }, { status: 404 });
  const stat = await fs.promises.stat(archive);
  const stream = Readable.toWeb(fs.createReadStream(archive));
  return new Response(stream as BodyInit, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${safeFileName(backup.name)}.tar.gz"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(_req: Request, ctx: Context) {
  const { id, backup } = await load(ctx);
  if (!backup) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await deleteBackupFile(backup).catch(() => {});
  await db.delete(backups).where(eq(backups.id, backup.id));
  await act(id, "backup", `Backup "${backup.name}" deleted`);
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, ctx: Context) {
  const { id, bid, backup } = await load(ctx);
  const { action } = (await req.json()) as { action?: string };
  if (action === "restore") {
    const result = await restoreBackup(id, bid);
    if (!result.ok) return NextResponse.json({ error: result.reason ?? "Restore failed" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (action === "manifest") {
    const [server] = await db.select().from(servers).where(eq(servers.id, id));
    if (!backup || !server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({
      manifest: {
        backup: backup.name,
        server: server.name,
        game: server.gameId,
        version: server.version,
        createdAt: backup.createdAt,
        sizeMb: backup.sizeMb,
        world: server.worldName,
        checksumAlgorithm: "SHA-256",
        checksum: backup.checksum,
        archive: `${safeFileName(backup.name)}.tar.gz`,
      },
    });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
