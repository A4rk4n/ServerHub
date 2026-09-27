import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { players, servers } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db.select().from(players).where(eq(players.serverId, s.id)).orderBy(desc(players.isOnline), desc(players.lastSeen));
  return NextResponse.json({ players: rows });
}
