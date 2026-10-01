import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { findMacro } from "@/lib/macros";
import { executeMacro } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string; macroId: string }> }) {
  const { id, macroId } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const macro = await findMacro(server.id, macroId);
  if (!macro) return NextResponse.json({ error: "Macro not found" }, { status: 404 });
  const result = await executeMacro(server, macro, "you");
  if (!result.ok) return NextResponse.json({ error: result.error ?? "Macro failed", stepsRun: result.stepsRun }, { status: 409 });
  return NextResponse.json({ ok: true, stepsRun: result.stepsRun });
}
