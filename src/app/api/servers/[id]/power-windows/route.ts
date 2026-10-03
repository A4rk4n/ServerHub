import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import {
  MAX_POWER_WINDOWS,
  desiredPowerState,
  nextTransitionAt,
  normalizeWindowSchedule,
  readWindowSchedule,
  validatePowerWindow,
  writeWindowSchedule,
} from "@/lib/power-windows";
import { act, logLine, powerScheduleChanged } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const schedule = await readWindowSchedule(server.id);
  const now = new Date();
  const next = nextTransitionAt(schedule, now);
  return NextResponse.json({
    schedule,
    desired: desiredPowerState(schedule, now),
    nextTransition: next ? next.toISOString() : null,
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  // Malformed JSON must never silently rewrite a schedule.
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const input = body as { enabled?: unknown; windows?: unknown };
  // Invalid windows are rejected loudly, not silently dropped — a window the
  // operator typed must either be saved exactly or explained.
  if (input.windows !== undefined) {
    if (!Array.isArray(input.windows)) return NextResponse.json({ error: "windows must be an array" }, { status: 400 });
    if (input.windows.length > MAX_POWER_WINDOWS) {
      return NextResponse.json({ error: `At most ${MAX_POWER_WINDOWS} windows per server` }, { status: 400 });
    }
    for (const candidate of input.windows) {
      const problem = validatePowerWindow(candidate);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }
  }
  if (input.enabled === true && (!Array.isArray(input.windows) || input.windows.length === 0)) {
    return NextResponse.json({ error: "Enable needs at least one window" }, { status: 400 });
  }
  const previous = await readWindowSchedule(server.id);
  const schedule = await writeWindowSchedule(server.id, normalizeWindowSchedule(input));
  powerScheduleChanged(server.id);
  if (schedule.enabled !== previous.enabled) {
    const message = schedule.enabled
      ? `${server.name} power schedule enabled (${schedule.windows.length} ${schedule.windows.length === 1 ? "window" : "windows"})`
      : `${server.name} power schedule disabled`;
    await act(server.id, "server", message).catch(() => {});
    await logLine(server.id, "system", "Scheduler", `${message}. The scheduler acts at window edges; manual power controls always win in between.`).catch(() => {});
  }
  const now = new Date();
  const next = nextTransitionAt(schedule, now);
  return NextResponse.json({
    schedule,
    desired: desiredPowerState(schedule, now),
    nextTransition: next ? next.toISOString() : null,
  });
}
