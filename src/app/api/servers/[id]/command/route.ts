import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { runCommand } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { command } = (await req.json().catch(() => ({}))) as { command?: string };
  if (!command?.trim()) return NextResponse.json({ error: "Empty command" }, { status: 400 });
  const result = await runCommand(s, command.trim());
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
