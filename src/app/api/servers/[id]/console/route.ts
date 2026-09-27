import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { players, servers } from "@/db/schema";
import { attachIfNeeded, getLogs, metricsFor, sweepTasks } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const num = Number(id);
  const [s0] = await db.select().from(servers).where(eq(servers.id, num));
  if (!s0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await attachIfNeeded(s0);
  await sweepTasks(num);
  const url = new URL(req.url);
  const after = url.searchParams.get("after");
  const logs = await getLogs(num, after ? Number(after) : undefined);
  const live =
    s0.status === "online" || s0.status === "starting"
      ? (await metricsFor(s0)).at(-1)
      : null;
  const [fresh] = await db.select().from(servers).where(eq(servers.id, num));
  const onlinePlayers = await db
    .select({ name: players.name, ping: players.ping, isOp: players.isOp })
    .from(players)
    .where(and(eq(players.serverId, num), eq(players.isOnline, true)));
  return NextResponse.json({
    status: fresh?.status ?? s0.status,
    logs: logs.map((l) => ({ id: l.id, ts: l.ts, level: l.level, source: l.source, message: l.message })),
    live: live ? { cpu: live.cpu, ram: live.ram, players: live.players, tps: live.tps } : null,
    onlinePlayers,
    lastStartedAt: fresh?.lastStartedAt ?? null,
  });
}
