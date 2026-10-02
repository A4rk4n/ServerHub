import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { normalizeMaintenanceState, readMaintenance, writeMaintenance } from "@/lib/maintenance";
import { act, logLine } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ maintenance: await readMaintenance(server.id) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  // Malformed JSON must never silently flip the maintenance flag.
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const previous = await readMaintenance(server.id);
  const requested = normalizeMaintenanceState(body);
  // `since` is owned by the server: stamped on enable, preserved while on.
  const next = requested.enabled
    ? { ...requested, since: previous.enabled ? previous.since : new Date().toISOString() }
    : { enabled: false, note: "", since: null };
  const maintenance = await writeMaintenance(server.id, next);
  if (maintenance.enabled !== previous.enabled) {
    const message = maintenance.enabled
      ? `${server.name} entered maintenance mode${maintenance.note ? ` — ${maintenance.note}` : ""}`
      : `${server.name} left maintenance mode`;
    await act(server.id, "server", message).catch(() => {});
    await logLine(server.id, "system", "Panel", `${message}. Scheduled tasks, auto-restarts, and announcements are ${maintenance.enabled ? "paused" : "active again"}.`).catch(() => {});
  }
  return NextResponse.json({ maintenance });
}
