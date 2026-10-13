import { NextResponse } from "next/server";
import { scanServerDiskUsage } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const result = await scanServerDiskUsage(Number(id));
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result);
}
