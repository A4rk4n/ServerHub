import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { detectConfigFormat, validateConfig } from "@/lib/config-editor";
import { buildTree, readServerFile, writeServerFile } from "@/lib/filesys";
import { act, logLine } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const relative = new URL(req.url).searchParams.get("path");
    if (!relative) return NextResponse.json({ tree: await buildTree(server) });
    const file = await readServerFile(server, relative);
    return NextResponse.json({ path: relative, content: file.content, editable: file.editable, edited: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { path?: string; content?: string; force?: boolean } | null;
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (!body.path || typeof body.content !== "string") return NextResponse.json({ error: "path and content are required" }, { status: 400 });
  try {
    const format = detectConfigFormat(body.path);
    if (format && !body.force) {
      const verdict = validateConfig(format, body.content);
      if (!verdict.ok) {
        return NextResponse.json(
          { error: `${format} validation failed${verdict.line ? ` at line ${verdict.line}` : ""}: ${verdict.message}`, line: verdict.line, format },
          { status: 422 }
        );
      }
    }
    const { safetyCopy } = await writeServerFile(server, body.path, body.content);
    const copyNote = safetyCopy ? ` Safety copy: ${safetyCopy}.` : "";
    await logLine(server.id, "system", "Files", `Wrote ${body.path} (${Buffer.byteLength(body.content, "utf8")} bytes).${copyNote}`);
    await act(server.id, "settings", `File ${body.path} saved on ${server.name}${safetyCopy ? ` (safety copy ${safetyCopy})` : ""}`);
    return NextResponse.json({ ok: true, format, safetyCopy });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
