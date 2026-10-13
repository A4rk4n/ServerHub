import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { addons, servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { fetchWorkshopDetails, WORKSHOP_SOURCE, workshopUpdateStatus } from "@/lib/workshop";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!getGame(server.gameId).workshop) return NextResponse.json({ error: "This game has no Steam Workshop support" }, { status: 400 });

  const rows = await db.select().from(addons).where(and(eq(addons.serverId, server.id), eq(addons.source, WORKSHOP_SOURCE)));
  if (rows.length === 0) return NextResponse.json({ checks: {} });

  let details;
  try {
    details = await fetchWorkshopDetails(rows.map((row) => row.projectId));
  } catch (err) {
    return NextResponse.json({ error: `Could not reach the Steam API: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
  const checks: Record<number, { status: "update" | "current" | "unknown"; updatedAt: number | null }> = {};
  for (const row of rows) {
    const latest = details.get(row.projectId);
    checks[row.id] = { status: workshopUpdateStatus(row.version, latest), updatedAt: latest?.timeUpdated ?? null };
  }
  return NextResponse.json({ checks });
}
