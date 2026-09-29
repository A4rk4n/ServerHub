import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { addons, backups, consoleLogs, files, installationEvents, installationJobs, players, servers, tasks } from "@/db/schema";
import { getGame } from "@/lib/games";
import { act, cancelInstallation, ensureRuntimeInitialized, cancelPendingRestart, killFlow, logLine, metricsFor, writeServerConfig } from "@/lib/runtime";
import { backupsDir, serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(ctx: Ctx) {
  await ensureRuntimeInitialized();
  const { id } = await ctx.params;
  const num = Number(id);
  if (!Number.isInteger(num)) return null;
  const [s] = await db.select().from(servers).where(eq(servers.id, num));
  return s ?? null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const s = await load(ctx);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const m = s.status === "online" ? (await metricsFor(s)).at(-1) : null;
  const g = getGame(s.gameId);
  const ps = await db.select().from(players).where(eq(players.serverId, s.id));
  return NextResponse.json({
    server: {
      ...s,
      serverPassword: s.serverPassword ? "••••••••" : "",
      adminPassword: s.adminPassword ? "••••••••" : "",
      game: { id: g.id, name: g.name, short: g.short, accent: g.accent, accentSoft: g.accentSoft, art: g.art, protocol: g.protocol, modSource: g.modSource, supportsMods: g.supportsMods },
    },
    live: m ? { cpu: m.cpu, ram: m.ram, players: m.players, tps: m.tps } : null,
    playerCount: ps.filter((p) => p.isOnline).length,
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await load(ctx);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json()) as Record<string, unknown>;
  const g = getGame(s.gameId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const changes: string[] = [];
  const nameLimit = s.gameId === "dragonwilds" ? 16 : 60;
  if (typeof body.name === "string" && body.name.trim().length > nameLimit) {
    return NextResponse.json({ error: `Server name must be ${nameLimit} characters or fewer` }, { status: 400 });
  }
  if (typeof body.name === "string" && body.name.trim() && body.name.length <= nameLimit) {
    patch.name = body.name.trim();
    changes.push("name");
  }
  if (typeof body.motd === "string") {
    patch.motd = body.motd.slice(0, 140);
    changes.push("motd");
  }
  if (typeof body.worldName === "string" && body.worldName.trim()) {
    if (s.gameId === "dragonwilds" && body.worldName.trim().length > 16) {
      return NextResponse.json({ error: "Dragonwilds world names are limited to 16 characters" }, { status: 400 });
    }
    patch.worldName = body.worldName.trim();
    changes.push("world");
  }
  if (typeof body.seed === "string") {
    patch.seed = body.seed;
    changes.push("seed");
  }
  if (typeof body.difficulty === "string" && ["peaceful", "easy", "normal", "hard"].includes(body.difficulty)) {
    patch.difficulty = body.difficulty;
    changes.push("difficulty");
  }
  if (typeof body.pvp === "boolean") {
    patch.pvp = body.pvp;
    changes.push("pvp");
  }
  if (typeof body.autoRestart === "boolean") { patch.autoRestart = body.autoRestart; changes.push("crash recovery"); }
  if (typeof body.maxCrashRestarts === "number" && Number.isFinite(body.maxCrashRestarts)) { patch.maxCrashRestarts = Math.min(20, Math.max(0, Math.round(body.maxCrashRestarts))); changes.push("restart limit"); }
  if (typeof body.restartWindowSec === "number" && Number.isFinite(body.restartWindowSec)) { patch.restartWindowSec = Math.min(3600, Math.max(30, Math.round(body.restartWindowSec))); changes.push("restart window"); }
  if (typeof body.autoBackupBeforeUpdate === "boolean") { patch.autoBackupBeforeUpdate = body.autoBackupBeforeUpdate; changes.push("update backup policy"); }
  if (typeof body.updateBackupRetention === "number" && Number.isFinite(body.updateBackupRetention)) { patch.updateBackupRetention = Math.min(20, Math.max(1, Math.round(body.updateBackupRetention))); changes.push("update backup retention"); }
  if (typeof body.publicAddress === "string" && /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$|^(?:\d{1,3}\.){3}\d{1,3}$/i.test(body.publicAddress.trim())) { patch.publicAddress = body.publicAddress.trim(); changes.push("public address"); }
  if (typeof body.bindAddress === "string" && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(body.bindAddress.trim())) { patch.bindAddress = body.bindAddress.trim(); changes.push("bind address"); }
  if (typeof body.readinessTimeoutSec === "number" && Number.isFinite(body.readinessTimeoutSec)) { patch.readinessTimeoutSec = Math.min(300, Math.max(10, Math.round(body.readinessTimeoutSec))); changes.push("readiness timeout"); }
  if (typeof body.port === "number" && Number.isInteger(body.port) && body.port >= 1024 && body.port <= 65535) {
    const clash = await db.select({ id: servers.id }).from(servers).where(and(eq(servers.port, body.port)));
    if (clash.some((c) => c.id !== s.id)) return NextResponse.json({ error: `Port ${body.port} is already in use` }, { status: 409 });
    patch.port = body.port;
    changes.push("port");
  }
  if (typeof body.memoryMb === "number") {
    patch.memoryMb = Math.min(g.maxMemory, Math.max(g.minMemory, Math.round(body.memoryMb)));
    changes.push("memory");
  }
  if (typeof body.maxPlayers === "number") {
    patch.maxPlayers = Math.min(g.maxPlayersCap, Math.max(1, Math.round(body.maxPlayers)));
    changes.push("slots");
  }
  if (typeof body.serverPassword === "string" && body.serverPassword !== "••••••••") {
    if (g.requiresPassword && body.serverPassword.length < 5) return NextResponse.json({ error: "Password must contain at least five characters" }, { status: 400 });
    patch.serverPassword = body.serverPassword.slice(0, 200);
    changes.push(s.gameId === "dragonwilds" ? "world password" : "password");
  }
  if (s.gameId === "dragonwilds") {
    if (typeof body.ownerId === "string") {
      if (!body.ownerId.trim()) return NextResponse.json({ error: "Dragonwilds requires your in-game Player ID" }, { status: 400 });
      patch.ownerId = body.ownerId.trim().slice(0, 200);
      changes.push("owner ID");
    }
    if (typeof body.adminPassword === "string" && body.adminPassword !== "••••••••") {
      if (body.adminPassword.length < 5) return NextResponse.json({ error: "Admin password must contain at least five characters" }, { status: 400 });
      patch.adminPassword = body.adminPassword.slice(0, 200);
      changes.push("admin password");
    }
  }
  if (g.installer === "manual") {
    if (typeof body.launchCommand === "string" && body.launchCommand.trim()) {
      patch.launchCommand = body.launchCommand.trim().slice(0, 2000);
      changes.push("launch command");
    }
    if (typeof body.launchArgs === "string") {
      patch.launchArgs = body.launchArgs.slice(0, 8000);
      changes.push("launch arguments");
    }
    if (typeof body.workingDirectory === "string" && body.workingDirectory !== s.workingDirectory) {
      const directory = body.workingDirectory.trim();
      if (s.status === "online") return NextResponse.json({ error: "Stop the server before changing its working directory" }, { status: 409 });
      if (directory && (!path.isAbsolute(directory) || !fs.existsSync(directory))) return NextResponse.json({ error: "Working directory must be an existing absolute folder" }, { status: 400 });
      patch.workingDirectory = directory;
      patch.managedDirectory = !directory;
      changes.push("working directory");
    }
  }
  const [updated] = await db.update(servers).set(patch).where(eq(servers.id, s.id)).returning();
  if (body.autoRestart === false && await cancelPendingRestart(s.id, "Settings")) updated.status = "offline";
  if (changes.length) {
    await writeServerConfig(updated).catch(async (error) => logLine(s.id, "warn", "Config", `Could not write managed config: ${String(error)}`));
    await logLine(s.id, "system", "Panel", `Configuration updated (${changes.join(", ")})${s.status === "online" ? " — restart required to apply" : ""}`);
    await act(s.id, "settings", `Settings updated on ${s.name} (${changes.join(", ")})`);
  }
  return NextResponse.json({ server: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await load(ctx);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (s.status === "installing") {
    const cancelled = await cancelInstallation(s.id, true);
    if (!cancelled.ok) return NextResponse.json({ error: cancelled.reason }, { status: 409 });
  }
  if (!["offline", "error"].includes(s.status)) {
    await killFlow(s.id);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (s.managedDirectory) {
    await fsp.rm(serverDir(s), { recursive: true, force: true }).catch(() => {});
    // Remove recoverable installer staging/rollback siblings for this server.
    const parent = path.dirname(serverDir(s));
    const prefix = `${path.basename(serverDir(s))}.serverhub-`;
    const entries = await fsp.readdir(parent).catch(() => [] as string[]);
    await Promise.all(entries.filter((entry) => entry.startsWith(prefix)).map((entry) => fsp.rm(path.join(parent, entry), { recursive: true, force: true })));
  }
  await fsp.rm(backupsDir(s.id), { recursive: true, force: true }).catch(() => {});
  await db.delete(addons).where(eq(addons.serverId, s.id));
  await db.delete(backups).where(eq(backups.serverId, s.id));
  await db.delete(consoleLogs).where(eq(consoleLogs.serverId, s.id));
  await db.delete(files).where(eq(files.serverId, s.id));
  await db.delete(players).where(eq(players.serverId, s.id));
  await db.delete(tasks).where(eq(tasks.serverId, s.id));
  await db.delete(installationEvents).where(eq(installationEvents.serverId, s.id));
  await db.delete(installationJobs).where(eq(installationJobs.serverId, s.id));
  await db.delete(servers).where(eq(servers.id, s.id));
  await act(null, "server", `Server "${s.name}" was permanently deleted`);
  return NextResponse.json({ ok: true });
}
