import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { sweepTasks } from "@/lib/runtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; tid: string }> };

async function load(ctx: Ctx) {
  const { id, tid } = await ctx.params;
  const [t] = await db.select().from(tasks).where(and(eq(tasks.id, Number(tid)), eq(tasks.serverId, Number(id))));
  return t ?? null;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const t = await load(ctx);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { enabled?: boolean; intervalMin?: number; name?: string };
  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
    if (body.enabled && !t.nextRunAt) patch.nextRunAt = new Date(Date.now() + t.intervalMin * 60000);
  }
  if (typeof body.intervalMin === "number") {
    patch.intervalMin = Math.min(10080, Math.max(5, Math.round(body.intervalMin)));
    patch.nextRunAt = new Date(Date.now() + (patch.intervalMin as number) * 60000);
  }
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  const [row] = await db.update(tasks).set(patch).where(eq(tasks.id, t.id)).returning();
  return NextResponse.json({ task: row });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const t = await load(ctx);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.delete(tasks).where(eq(tasks.id, t.id));
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, ctx: Ctx) {
  const t = await load(ctx);
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { action } = (await req.json()) as { action?: string };
  if (action === "run") {
    await db.update(tasks).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(tasks.id, t.id));
    await sweepTasks(t.serverId);
    const [fresh] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    return NextResponse.json({ ok: true, task: fresh });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
