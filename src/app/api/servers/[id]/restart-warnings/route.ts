import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { broadcastCommand, normalizeWarningConfig, warningMessage } from "@/lib/restart-warnings";
import { cancelCountdown, getCountdown, readWarningConfigFor, runCommand, writeWarningConfigFor } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const config = await readWarningConfigFor(server.id);
  const supported = broadcastCommand(server.gameId, config.template, "x") !== null;
  return NextResponse.json({ config, supported, countdown: getCountdown(server.id) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const config = normalizeWarningConfig(body);
  await writeWarningConfigFor(server.id, config);
  return NextResponse.json({ config, supported: broadcastCommand(server.gameId, config.template, "x") !== null });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "cancel") {
    const cancelled = await cancelCountdown(server.id, "cancelled from the panel");
    return NextResponse.json({ ok: cancelled, cancelled });
  }
  if (body.action === "test") {
    const config = await readWarningConfigFor(server.id);
    const command = broadcastCommand(server.gameId, config.template, warningMessage("restart", 300));
    if (!command) return NextResponse.json({ error: "This game has no broadcast command — set a custom template first" }, { status: 400 });
    const result = await runCommand(server, command, "Scheduler");
    return NextResponse.json(result.ok ? { ok: true, command } : { error: result.reason ?? "Command failed" }, { status: result.ok ? 200 : 409 });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
