import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { backups, servers } from "@/db/schema";
import { BULK_LIMIT, bulkBackupLabel, partitionBulkBackup, type BulkBackupOutcome } from "@/lib/bulk-backup";
import { createBackup } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? ([...new Set(body.ids.filter((id) => Number.isInteger(id)))] as number[]) : [];
  if (ids.length === 0) return NextResponse.json({ error: "No servers selected" }, { status: 400 });
  if (ids.length > BULK_LIMIT) return NextResponse.json({ error: `At most ${BULK_LIMIT} servers per request` }, { status: 400 });

  const rows = await db.select().from(servers).where(inArray(servers.id, ids));
  const { eligible, skipped } = partitionBulkBackup(rows);
  const results: BulkBackupOutcome[] = skipped.map((s) => ({ id: s.id, name: s.name, outcome: "skipped", reason: `status is ${s.status}` }));

  const label = bulkBackupLabel();
  for (const server of eligible) {
    // One building archive per server at a time: overlapping tars of the
    // same directory double the IO for two near-identical snapshots.
    const [building] = await db
      .select({ id: backups.id })
      .from(backups)
      .where(and(eq(backups.serverId, server.id), eq(backups.status, "building")))
      .limit(1);
    if (building) {
      results.push({ id: server.id, name: server.name, outcome: "skipped", reason: "a backup is already building" });
      continue;
    }
    try {
      // createBackup returns as soon as the row exists; the archive
      // builds in the background exactly like the per-server button.
      const row = await createBackup(server.id, label, "fleet backup");
      if (row) results.push({ id: server.id, name: server.name, outcome: "started" });
      else results.push({ id: server.id, name: server.name, outcome: "failed", reason: "server not found" });
    } catch (error) {
      results.push({ id: server.id, name: server.name, outcome: "failed", reason: error instanceof Error ? error.message : String(error) });
    }
  }
  results.sort((a, b) => a.id - b.id);
  return NextResponse.json({ label, results });
}
