import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { moderationActions, playerSessions, players, servers } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db.select().from(players).where(eq(players.serverId, s.id)).orderBy(desc(players.isOnline), desc(players.lastSeen));
  const sessions=await db.select().from(playerSessions).where(eq(playerSessions.serverId,s.id)).orderBy(desc(playerSessions.joinedAt));
  const now=Date.now(); const enriched=rows.map(player=>{const related=sessions.filter(session=>session.observationKey===player.externalId);const totalSeconds=related.reduce((sum,session)=>sum+(session.leftAt?session.durationSec:Math.max(session.durationSec,Math.round((now-(session.joinedAt?.getTime()??now))/1000))),0);const current=related.find(session=>!session.leftAt);return{...player,observedIdentity:player.externalId.startsWith("steam-a2s:"),sessionCount:related.length,totalObservedSeconds:totalSeconds,currentSessionSeconds:current?Math.max(current.durationSec,Math.round((now-(current.joinedAt?.getTime()??now))/1000)):0,firstObservedAt:related.at(-1)?.joinedAt??player.firstSeen};});
  const moderation=await db.select().from(moderationActions).where(eq(moderationActions.serverId,s.id)).orderBy(desc(moderationActions.createdAt)).limit(100);
  return NextResponse.json({ players: enriched, sessions: sessions.slice(0,100), moderation });
}
