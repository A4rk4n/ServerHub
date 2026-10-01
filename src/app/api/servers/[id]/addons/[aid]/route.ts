import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { addons, servers } from "@/db/schema";
import { act, logLine } from "@/lib/runtime";
import { safePath, serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; aid: string }> };

async function load(ctx: Context) {
  const { id, aid } = await ctx.params;
  const [addon] = await db.select().from(addons).where(and(eq(addons.id, Number(aid)), eq(addons.serverId, Number(id))));
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return { addon, server, id: Number(id) };
}

export async function PATCH(req: Request, ctx: Context) {
  const { addon, server, id } = await load(ctx);
  if (!addon || !server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // A malformed body must NOT coerce `enabled` to false and silently disable
  // the add-on — reject it before Boolean() ever runs.
  const parsed = (await req.json().catch(() => null)) as { enabled?: boolean } | null;
  if (parsed === null || typeof parsed !== "object" || typeof parsed.enabled !== "boolean") return NextResponse.json({ error: "Invalid JSON body — a boolean `enabled` is required" }, { status: 400 });
  const targetEnabled = parsed.enabled;
  let relative = addon.filePath;
  if (relative) {
    const current = safePath(serverDir(server), relative);
    if (!current) return NextResponse.json({ error: "Stored add-on path is invalid" }, { status: 400 });
    const nextRelative = targetEnabled ? relative.replace(/\.disabled$/, "") : `${relative}.disabled`;
    const destination = safePath(serverDir(server), nextRelative);
    if (!destination) return NextResponse.json({ error: "Add-on path is invalid" }, { status: 400 });
    if (current !== destination) await fsp.rename(current, destination).catch((error) => { throw new Error(`Could not rename ${path.basename(current)}: ${String(error)}`); });
    relative = nextRelative;
  }
  const [row] = await db.update(addons).set({ enabled: targetEnabled, filePath: relative }).where(eq(addons.id, addon.id)).returning();
  await logLine(id, "system", "Mods", `${targetEnabled ? "Enabled" : "Disabled"} ${addon.name}${server.status === "online" ? " — restart required" : ""}.`);
  return NextResponse.json({ addon: row });
}

export async function DELETE(_req: Request, ctx: Context) {
  const { addon, server, id } = await load(ctx);
  if (!addon || !server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (addon.filePath) {
    const file = safePath(serverDir(server), addon.filePath);
    if (file) await fsp.rm(file, { force: true });
  }
  await db.delete(addons).where(eq(addons.id, addon.id));
  await logLine(id, "system", "Mods", `Uninstalled ${addon.name}.`);
  await act(id, "addon", `${addon.name} uninstalled`);
  return NextResponse.json({ ok: true });
}
