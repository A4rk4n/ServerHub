import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { playerSessions, servers } from "@/db/schema";
import { dailyPlayerSeries, summarizePlayerActivity } from "@/lib/player-analytics";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(request.url);
  const days = Math.min(30, Math.max(1, Math.round(Number(url.searchParams.get("days")) || 7)));
  const sessions = await db.select().from(playerSessions).where(eq(playerSessions.serverId, server.id));
  const now = Date.now();
  return NextResponse.json({
    days,
    summary: summarizePlayerActivity(sessions, now, days),
    daily: dailyPlayerSeries(sessions, now, days),
  });
}
