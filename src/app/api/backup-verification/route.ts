import { NextResponse } from "next/server";
import { db } from "@/db";
import { backups, servers } from "@/db/schema";
import { summarizeVerification } from "@/lib/backup-verification";
import { readBackupVerification, sweepBackupVerification } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function buildReport() {
  const rows = await db.select().from(backups);
  const fleet = await db.select({ id: servers.id, name: servers.name }).from(servers);
  const nameBy = new Map(fleet.map((server) => [server.id, server.name]));
  const state = await readBackupVerification();
  const summary = summarizeVerification(state, rows.map((row) => row.id));
  const corrupt = rows
    .filter((row) => state[String(row.id)] && !state[String(row.id)].ok)
    .map((row) => ({
      backupId: row.id,
      serverId: row.serverId,
      serverName: nameBy.get(row.serverId) ?? `Server ${row.serverId}`,
      backupName: row.name,
      problem: state[String(row.id)].problem,
      verifiedAt: state[String(row.id)].verifiedAt,
    }))
    .sort((a, b) => b.backupId - a.backupId);
  return { summary, corrupt };
}

export async function GET() {
  return NextResponse.json(await buildReport());
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = (body as { action?: unknown })?.action;
  if (action !== "verify-now") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const result = await sweepBackupVerification(Date.now(), true);
  return NextResponse.json({ ...result, ...(await buildReport()) });
}
