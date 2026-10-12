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
import { curseforgeLatest, modrinthLatest, type LatestAddonBuild } from "@/lib/addon-sources";
import { planAddonUpdates } from "@/lib/addon-updates";
import { isCurseforgeAddon } from "@/lib/curseforge";
import { readCurseforgeKey } from "@/lib/curseforge-key";
import { act } from "@/lib/runtime";
import { safePath, serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

const headers = { "User-Agent": "ServerHub/1.0 (local desktop server manager)" };

type Installed = typeof addons.$inferSelect;

async function latestFor(addon: Installed, gameVersion: string, apiKey: string): Promise<LatestAddonBuild | null> {
  return isCurseforgeAddon(addon.source) ? curseforgeLatest(apiKey, addon.projectId, gameVersion) : modrinthLatest(addon.projectId, gameVersion);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const installed = await db.select().from(addons).where(eq(addons.serverId, server.id));
  const apiKey = await readCurseforgeKey();

  // The two providers get separate lookup maps: project ids live in
  // different namespaces, so one map could collide.
  const warnings = new Set<string>();
  const planFor = async (subset: Installed[]) => {
    const latestByProject: Record<string, { versionNumber: string } | null> = {};
    for (const addon of subset) {
      if (!addon.projectId || addon.projectId in latestByProject) continue;
      try {
        const latest = await latestFor(addon, server.version, apiKey);
        latestByProject[addon.projectId] = latest ? { versionNumber: latest.versionNumber } : null;
      } catch (error) {
        latestByProject[addon.projectId] = null;
        warnings.add(
          isCurseforgeAddon(addon.source)
            ? !apiKey
              ? "CurseForge mods need an API key — they report unknown"
              : "CurseForge unavailable — its mods report unknown"
            : "Modrinth unavailable — unreachable mods report unknown"
        );
        void error;
      }
    }
    return planAddonUpdates(subset, latestByProject);
  };

  const modrinthChecks = await planFor(installed.filter((addon) => !isCurseforgeAddon(addon.source)));
  const curseforgeChecks = await planFor(installed.filter((addon) => isCurseforgeAddon(addon.source)));
  const byId = new Map([...modrinthChecks, ...curseforgeChecks].map((check) => [check.addonId, check]));
  const checks = installed.map((addon) => byId.get(addon.id)!);
  return NextResponse.json({
    checks,
    updates: checks.filter((c) => c.status === "update").length,
    source: warnings.size > 0 ? [...warnings].join("; ") : "Modrinth + CurseForge (live)",
  });
}

async function download(url: string, destination: string, expected?: { algo: "sha512" | "sha1"; hex: string }): Promise<void> {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Mod download failed: HTTP ${response.status}`);
  const temporary = `${destination}.download`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const output = fs.createWriteStream(temporary);
  await finished(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(output));
  if (expected) {
    const digest = crypto.createHash(expected.algo).update(await fsp.readFile(temporary)).digest("hex");
    if (digest !== expected.hex) {
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

  let latest: LatestAddonBuild | null;
  try {
    latest = await latestFor(addon, server.version, await readCurseforgeKey());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
  if (!latest) return NextResponse.json({ error: "No compatible version is available" }, { status: 404 });
  if (latest.versionNumber === addon.version) return NextResponse.json({ ok: true, status: "current", version: addon.version });
  if (!latest.url) {
    return NextResponse.json({ error: `The author of ${addon.name} has disabled third-party downloads — update it manually from CurseForge` }, { status: 502 });
  }

  const relative = path.posix.join("mods", latest.filename);
  const destination = safePath(serverDir(server), relative);
  if (!destination) return NextResponse.json({ error: "The mod filename is not a safe path" }, { status: 400 });
  try {
    const expected = latest.sha512 ? { algo: "sha512" as const, hex: latest.sha512 } : latest.sha1 ? { algo: "sha1" as const, hex: latest.sha1 } : undefined;
    await download(latest.url, destination, expected);
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
