import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { readServerTags, writeServerTags } from "@/lib/server-tags";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ tags: await readServerTags(server.id) });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { tags?: unknown } | null;
  // Malformed JSON must never silently wipe a server's tags.
  if (body === null || typeof body !== "object" || !Array.isArray(body.tags)) return NextResponse.json({ error: "Invalid JSON body — an array `tags` is required" }, { status: 400 });
  const tags = await writeServerTags(server.id, body.tags as string[]);
  return NextResponse.json({ tags });
}
