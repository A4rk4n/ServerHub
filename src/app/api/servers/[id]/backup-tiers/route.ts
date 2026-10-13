import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { backups, servers } from "@/db/schema";
import {
  MAX_DAILY_TIERS,
  MAX_WEEKLY_TIERS,
  normalizeBackupTiers,
  readBackupTiers,
  selectTieredBackupsToPrune,
  writeBackupTiers,
  type BackupTiers,
} from "@/lib/backup-tiers";
import { act, logLine } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

/** What the policy would prune right now — so enabling it is never a surprise. */
async function preview(serverId: number, protectedId: number | null, tiers: BackupTiers) {
  if (!tiers.enabled) return { wouldPrune: 0, total: 0 };
  const rows = await db.select().from(backups).where(eq(backups.serverId, serverId));
  const pruneIds = selectTieredBackupsToPrune(rows, tiers, protectedId ? [protectedId] : []);
  return { wouldPrune: pruneIds.length, total: rows.length };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const tiers = await readBackupTiers(server.id);
  return NextResponse.json({ tiers, ...(await preview(server.id, server.updateSafetyBackupId, tiers)) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  // Malformed JSON must never silently rewrite a retention policy.
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const input = body as { enabled?: unknown; daily?: unknown; weekly?: unknown };
  for (const [key, max] of [["daily", MAX_DAILY_TIERS], ["weekly", MAX_WEEKLY_TIERS]] as const) {
    const value = input[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max)) {
      return NextResponse.json({ error: `${key} must be an integer between 0 and ${max}` }, { status: 400 });
    }
  }
  if (input.enabled === true && input.daily === 0 && input.weekly === 0) {
    return NextResponse.json({ error: "Enable needs at least one daily or weekly slot" }, { status: 400 });
  }
  const previous = await readBackupTiers(server.id);
  const tiers = await writeBackupTiers(server.id, normalizeBackupTiers(input));
  if (tiers.enabled !== previous.enabled) {
    const message = tiers.enabled
      ? `${server.name} tiered backup retention enabled (keep ${tiers.daily} daily + ${tiers.weekly} weekly)`
      : `${server.name} tiered backup retention disabled`;
    await act(server.id, "backup", message).catch(() => {});
    await logLine(server.id, "system", "Backup", `${message}. ${tiers.enabled ? "Tiered selection replaces the flat count/age limits; pruning happens after each backup or on a scheduled prune task." : "The flat count/age limits apply again."}`).catch(() => {});
  }
  return NextResponse.json({ tiers, ...(await preview(server.id, server.updateSafetyBackupId, tiers)) });
}
