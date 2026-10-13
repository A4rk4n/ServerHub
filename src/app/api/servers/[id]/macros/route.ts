import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { MAX_MACROS_PER_SERVER, loadMacros, normalizeMacro, saveMacros } from "@/lib/macros";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const all = await loadMacros();
  return NextResponse.json({ macros: all[String(server.id)] ?? [] });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const macro = normalizeMacro(body);
  if (!macro) return NextResponse.json({ error: "A macro needs a name and at least one command" }, { status: 400 });
  const all = await loadMacros();
  const list = all[String(server.id)] ?? [];
  if (list.length >= MAX_MACROS_PER_SERVER) return NextResponse.json({ error: `A server can have at most ${MAX_MACROS_PER_SERVER} macros` }, { status: 400 });
  all[String(server.id)] = [...list, macro];
  await saveMacros(all);
  return NextResponse.json({ macro }, { status: 201 });
}
