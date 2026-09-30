import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { backups, servers } from "@/db/schema";
import { applyBackupRetention, createBackup } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db.select().from(backups).where(eq(backups.serverId, s.id)).orderBy(desc(backups.id));
  return NextResponse.json({
    backups: rows,
    retention: { count: s.backupRetentionCount, days: s.backupRetentionDays, protectedId: s.updateSafetyBackupId ?? null },
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { name?: string; action?: string };
  if (body.action === "prune") {
    const result = await applyBackupRetention(s.id);
    return NextResponse.json(result);
  }
  const row = await createBackup(s.id, body.name);
  return NextResponse.json({ backup: row }, { status: 201 });
}
