import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { buildVerdicts } from "@/lib/connection-doctor";
import { detectPublicIp, probePortBound } from "@/lib/connection-probe";
import { getGame } from "@/lib/games";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const game = getGame(server.gameId);
  const [portBound, detectedPublic] = await Promise.all([
    probePortBound(game.protocol, server.bindAddress, server.port),
    detectPublicIp(),
  ]);
  const facts = {
    serverStatus: server.status,
    portBound,
    bindAddress: server.bindAddress,
    port: server.port,
    protocol: game.protocol,
    configuredPublic: server.publicAddress,
    detectedPublic,
  };
  return NextResponse.json({ facts, verdicts: buildVerdicts(facts) });
}
