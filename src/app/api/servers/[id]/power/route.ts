import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { installFlow, killFlow, restartFlow, startFlow, stopFlow } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const num = Number(id);
  const [s] = await db.select().from(servers).where(eq(servers.id, num));
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { action } = (await req.json()) as { action?: string };
  switch (action) {
    case "start":
      return NextResponse.json(await startFlow(num));
    case "stop":
      return NextResponse.json(await stopFlow(num));
    case "restart":
      return NextResponse.json(await restartFlow(num));
    case "kill":
      return NextResponse.json(await killFlow(num));
    case "install":
      return NextResponse.json(await installFlow(num));
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
