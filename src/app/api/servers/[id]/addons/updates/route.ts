import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { addons, servers } from "@/db/schema";
import { modrinthVersionsUrl, pickLatestVersion, planAddonUpdates, type ModrinthVersionLike } from "@/lib/addon-updates";
import { act } from "@/lib/runtime";
import { safePath, serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Test hook: E2E points this at a local mock; production never sets it.
const BASE = process.env.SERVERHUB_MODRINTH_BASE ?? "https://api.modrinth.com/v2";
const headers = { "User-Agent": "ServerHub/1.0 (local desktop server manager)" };

async function latestFor(projectId: string, gameVersion: string): Promise<ReturnType<typeof pickLatestVersion>> {
  const response = await fetch(modrinthVersionsUrl(BASE, projectId, gameVersion), { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`Modrinth returned HTTP ${response.status}`);
  return pickLatestVersion((await response.json()) as ModrinthVersionLike[]);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const installed = await db.select().from(addons).where(eq(addons.serverId, server.id));
  const latestByProject: Record<string, { versionNumber: string } | null> = {};
  let unreachable = false;
  for (const addon of installed) {
    if (!addon.projectId || addon.projectId in latestByProject) continue;
    try {
      const latest = await latestFor(addon.projectId, server.version);
      latestByProject[addon.projectId] = latest ? { versionNumber: latest.versionNumber } : null;
    } catch {
      latestByProject[addon.projectId] = null;
      unreachable = true;
    }
  }
  const checks = planAddonUpdates(installed, latestByProject);
  return NextResponse.json({
    checks,
    updates: checks.filter((c) => c.status === "update").length,
    source: unreachable ? "Modrinth unavailable — unreachable mods report unknown" : "Modrinth (live)",
  });
}

async function download(url: string, destination: string, expectedSha512?: string): Promise<void> {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Mod download failed: HTTP ${response.status}`);
  const temporary = `${destination}.download`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const output = fs.createWriteStream(temporary);
  await finished(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(output));
  if (expectedSha512) {
    const digest = crypto.createHash("sha512").update(await fsp.readFile(temporary)).digest("hex");
    if (digest !== expectedSha512) {
      await fsp.rm(temporary, { force: true });
      throw new Error("Downloaded mod failed its checksum — nothing was changed");
    }
  }
  await fsp.rename(temporary, destination);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { addonId?: number } | null;
  if (!body || typeof body.addonId !== "number") return NextResponse.json({ error: "Invalid JSON body — a numeric `addonId` is required" }, { status: 400 });
  const [addon] = await db.select().from(addons).where(and(eq(addons.id, body.addonId), eq(addons.serverId, server.id)));
  if (!addon) return NextResponse.json({ error: "Addon not found" }, { status: 404 });
  if (!addon.projectId) return NextResponse.json({ error: "This addon was installed manually — update it by replacing its file" }, { status: 409 });

  let latest: ReturnType<typeof pickLatestVersion>;
  try {
    latest = await latestFor(addon.projectId, server.version);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
  if (!latest) return NextResponse.json({ error: "No compatible version is available on Modrinth" }, { status: 404 });
  if (latest.versionNumber === addon.version) return NextResponse.json({ ok: true, status: "current", version: addon.version });

  const relative = path.posix.join("mods", latest.filename);
  const destination = safePath(serverDir(server), relative);
  if (!destination) return NextResponse.json({ error: "The mod filename is not a safe path" }, { status: 400 });
  try {
    await download(latest.url, destination, latest.sha512);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
  // The new file is verified and in place — only now retire the old one.
  if (addon.filePath && addon.filePath !== relative) {
    const previous = safePath(serverDir(server), addon.filePath);
    if (previous) await fsp.rm(previous, { force: true }).catch(() => {});
  }
  const [updated] = await db
    .update(addons)
    .set({ version: latest.versionNumber, filePath: relative })
    .where(eq(addons.id, addon.id))
    .returning();
  await act(server.id, "addon", `Updated ${addon.name} ${addon.version} → ${latest.versionNumber}`);
  return NextResponse.json({ ok: true, status: "updated", addon: updated });
}
