import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers, type Server } from "@/db/schema";
import { act, logLine } from "@/lib/runtime";
import { safePath, serverDir } from "@/lib/storage";
import { canDeleteWorld, couldBeWorldDir, isWorldCapable, type WorldInfo } from "@/lib/worlds";

export const dynamic = "force-dynamic";

const SIZE_ENTRY_CAP = 20_000;

async function loadServer(id: string): Promise<{ server?: Server; error?: NextResponse }> {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!isWorldCapable(server.gameId)) {
    return { error: NextResponse.json({ error: "World management is available for Minecraft Java servers" }, { status: 400 }) };
  }
  return { server };
}

async function dirStats(root: string): Promise<{ sizeBytes: number; lastModified: number }> {
  let sizeBytes = 0;
  let lastModified = 0;
  let entries = 0;
  async function walk(dir: string): Promise<void> {
    if (entries > SIZE_ENTRY_CAP) return;
    const list = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of list) {
      if (++entries > SIZE_ENTRY_CAP) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const stat = await fsp.stat(full).catch(() => null);
        if (stat) {
          sizeBytes += stat.size;
          if (stat.mtimeMs > lastModified) lastModified = stat.mtimeMs;
        }
      }
    }
  }
  await walk(root);
  return { sizeBytes, lastModified: Math.round(lastModified) };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { server, error } = await loadServer(id);
  if (error || !server) return error ?? NextResponse.json({ error: "Not found" }, { status: 404 });

  const root = serverDir(server);
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const worlds: WorldInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !couldBeWorldDir(entry.name)) continue;
    const hasLevel = await fsp.stat(path.join(root, entry.name, "level.dat")).catch(() => null);
    if (!hasLevel) continue;
    const stats = await dirStats(path.join(root, entry.name));
    worlds.push({ name: entry.name, ...stats, active: entry.name === server.worldName });
  }
  worlds.sort((a, b) => Number(b.active) - Number(a.active) || b.lastModified - a.lastModified);
  return NextResponse.json({
    worlds,
    activeWorld: server.worldName,
    activeExists: worlds.some((world) => world.active),
    status: server.status,
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { server, error } = await loadServer(id);
  if (error || !server) return error ?? NextResponse.json({ error: "Not found" }, { status: 404 });

  let name = "";
  try {
    const body = (await req.json()) as { name?: unknown };
    name = typeof body.name === "string" ? body.name.trim() : "";
  } catch {
    // handled below
  }
  if (!name || !couldBeWorldDir(name)) return NextResponse.json({ error: "Expected a world folder `name`" }, { status: 400 });

  const problem = canDeleteWorld(name, server.worldName, server.status);
  if (problem) return NextResponse.json({ error: problem }, { status: 409 });

  const root = serverDir(server);
  const full = safePath(root, name);
  if (!full) return NextResponse.json({ error: "Invalid world folder name" }, { status: 400 });
  const hasLevel = await fsp.stat(path.join(full, "level.dat")).catch(() => null);
  if (!hasLevel) return NextResponse.json({ error: "No world with this name exists" }, { status: 404 });

  await fsp.rm(full, { recursive: true, force: true });
  await logLine(server.id, "warn", "Worlds", `Deleted world "${name}".`);
  await act(server.id, "security", `World "${name}" deleted on ${server.name}`);
  return NextResponse.json({ ok: true });
}
