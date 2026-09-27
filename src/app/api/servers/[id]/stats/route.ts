import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { attachIfNeeded, metricsFor, sweepTasks } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s0] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await attachIfNeeded(s0);
  await sweepTasks(s0.id);
  const metrics = await metricsFor(s0);
  const [fresh] = await db.select().from(servers).where(eq(servers.id, s0.id));
  return NextResponse.json({ metrics, status: fresh?.status ?? s0.status });
}
