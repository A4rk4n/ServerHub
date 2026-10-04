import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { MAX_NOTES_CHARS, normalizeNotes, readServerNotes, writeServerNotes } from "@/lib/server-notes";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const notes = await readServerNotes(server.id);
  return NextResponse.json({ text: notes?.text ?? "", updatedAt: notes?.updatedAt ?? null });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  // Malformed JSON must never silently wipe a runbook.
  if (body === null || typeof body !== "object" || typeof body.text !== "string") {
    return NextResponse.json({ error: "Invalid JSON body — a string `text` is required" }, { status: 400 });
  }
  const text = normalizeNotes(body.text);
  if (text === null) return NextResponse.json({ error: `Notes are limited to ${MAX_NOTES_CHARS.toLocaleString()} characters` }, { status: 400 });
  const saved = await writeServerNotes(server.id, text);
  return NextResponse.json({ text: saved?.text ?? "", updatedAt: saved?.updatedAt ?? null });
}
