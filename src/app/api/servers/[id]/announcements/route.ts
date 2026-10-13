import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { normalizeAnnouncementConfig } from "@/lib/announcements";
import { broadcastCommand } from "@/lib/restart-warnings";
import { announceNow, getAnnouncerState, readAnnouncementConfigFor, writeAnnouncementConfigFor } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const config = await readAnnouncementConfigFor(server.id);
  const supported = broadcastCommand(server.gameId, config.template, "x") !== null;
  return NextResponse.json({ config, supported, state: getAnnouncerState(server.id) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  // Malformed JSON must never silently reset a server's rotation to defaults.
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const config = normalizeAnnouncementConfig(body);
  await writeAnnouncementConfigFor(server.id, config);
  return NextResponse.json({ config, supported: broadcastCommand(server.gameId, config.template, "x") !== null });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "send-now") {
    const result = await announceNow(server.id);
    return NextResponse.json(result.ok ? { ok: true, message: result.message } : { error: result.reason ?? "Broadcast failed" }, { status: result.ok ? 200 : 409 });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
