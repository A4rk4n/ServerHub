import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { loadMacros, normalizeMacro, saveMacros } from "@/lib/macros";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, ctx: { params: Promise<{ id: string; macroId: string }> }) {
  const { id, macroId } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const all = await loadMacros();
  const list = all[String(server.id)] ?? [];
  const index = list.findIndex((macro) => macro.id === macroId);
  if (index === -1) return NextResponse.json({ error: "Macro not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const macro = normalizeMacro(body, macroId);
  if (!macro) return NextResponse.json({ error: "A macro needs a name and at least one command" }, { status: 400 });
  list[index] = macro;
  all[String(server.id)] = list;
  await saveMacros(all);
  return NextResponse.json({ macro });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; macroId: string }> }) {
  const { id, macroId } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const all = await loadMacros();
  const list = all[String(server.id)] ?? [];
  if (!list.some((macro) => macro.id === macroId)) return NextResponse.json({ error: "Macro not found" }, { status: 404 });
  all[String(server.id)] = list.filter((macro) => macro.id !== macroId);
  await saveMacros(all);
  return NextResponse.json({ ok: true });
}
