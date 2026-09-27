import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { servers, tasks } from "@/db/schema";

export const dynamic = "force-dynamic";

const TYPES = ["restart", "backup", "command", "broadcast"];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db.select().from(tasks).where(eq(tasks.serverId, s.id)).orderBy(asc(tasks.id));
  return NextResponse.json({ tasks: rows });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as { name?: string; type?: string; payload?: string; intervalMin?: number };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const type = TYPES.includes(body.type ?? "") ? body.type! : "command";
  if ((type === "command" || type === "broadcast") && !body.payload?.trim())
    return NextResponse.json({ error: "This task type needs a payload (command / message)" }, { status: 400 });
  const intervalMin = Math.min(10080, Math.max(5, Math.round(Number(body.intervalMin ?? 360))));
  const [row] = await db
    .insert(tasks)
    .values({
      serverId: s.id,
      name,
      type,
      payload: body.payload?.trim() ?? "",
      intervalMin,
      nextRunAt: new Date(Date.now() + intervalMin * 60000),
    })
    .returning();
  return NextResponse.json({ task: row }, { status: 201 });
}
