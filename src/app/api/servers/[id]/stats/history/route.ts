import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { readHistory } from "@/lib/metrics-history";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(request.url);
  const hours = Math.min(48, Math.max(1, Number(url.searchParams.get("hours")) || 24));
  const points = await readHistory(server.id, hours * 60 * 60 * 1000);
  return NextResponse.json({ hours, points });
}
