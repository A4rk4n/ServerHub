import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { moderationActions, players, servers } from "@/db/schema";
import { moderationCommand } from "@/lib/moderation";
import { act, runCommand } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [player] = await db.select().from(players).where(and(eq(players.serverId, server.id), eq(players.id, Number(pid))));
  if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });
  const { action, reason, confirmedCommand, durationMinutes } = (await req.json()) as { action?: string; reason?: string; confirmedCommand?: string; durationMinutes?: number };
  let command:string;try{command=moderationCommand(server.gameId,action??"",player.name,reason)}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unsupported moderation action"},{status:400})}
  if(confirmedCommand!==command)return NextResponse.json({error:"Command confirmation does not match",command},{status:409});
  const result = await runCommand(server, command);
  await db.insert(moderationActions).values({serverId:server.id,playerId:player.id,action:action!,target:player.name,command,reason:(reason??"").slice(0,120),status:result.ok?(action==="ban"&&Number.isFinite(durationMinutes)&&durationMinutes!>0?"pending-expiration":"sent"):"failed",expiresAt:action==="ban"&&Number.isFinite(durationMinutes)&&durationMinutes!>0?new Date(Date.now()+Math.min(durationMinutes!,525600)*60000):null});
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

  if (action === "kick") await db.update(players).set({ isOnline: false, lastSeen: new Date() }).where(eq(players.id, player.id));
  if (action === "ban") await db.update(players).set({ isBanned: true, isOnline: false, isOp: false }).where(eq(players.id, player.id));
  if (action === "unban") await db.update(players).set({ isBanned: false }).where(eq(players.id, player.id));
  if (action === "op") await db.update(players).set({ isOp: true }).where(eq(players.id, player.id));
  if (action === "deop") await db.update(players).set({ isOp: false }).where(eq(players.id, player.id));
  await act(server.id, "player", `${action} command sent for ${player.name} on ${server.name}`);
  const [fresh] = await db.select().from(players).where(eq(players.id, player.id));
  return NextResponse.json({ ok: true, player: fresh });
}

export async function PATCH(req:Request,ctx:{params:Promise<{id:string;pid:string}>}){const {id,pid}=await ctx.params;const [player]=await db.select().from(players).where(and(eq(players.serverId,Number(id)),eq(players.id,Number(pid))));if(!player)return NextResponse.json({error:"Player not found"},{status:404});const body=await req.json() as {trusted?:boolean;notes?:string};const notes=typeof body.notes==="string"?body.notes.trim().slice(0,1000):player.notes;const trusted=typeof body.trusted==="boolean"?body.trusted:player.trusted;await db.update(players).set({trusted,notes}).where(eq(players.id,player.id));const [fresh]=await db.select().from(players).where(eq(players.id,player.id));return NextResponse.json({ok:true,player:fresh})}
