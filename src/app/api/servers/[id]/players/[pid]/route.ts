import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { players, servers } from "@/db/schema";
import { act, runCommand } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [player] = await db.select().from(players).where(and(eq(players.serverId, server.id), eq(players.id, Number(pid))));
  if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });
  const { action } = (await req.json()) as { action?: string };
  const command: Record<string, string> = {
    kick: `kick ${player.name}`,
    ban: `ban ${player.name}`,
    unban: `pardon ${player.name}`,
    op: `op ${player.name}`,
    deop: `deop ${player.name}`,
  };
  if (!action || !command[action]) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const result = await runCommand(server, command[action]);
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
