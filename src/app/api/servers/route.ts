import fs from "node:fs";
import path from "node:path";
import { protectAndVerify } from "@/lib/credential-vault";
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame, hasGame } from "@/lib/games";
import { readAllServerTags } from "@/lib/server-tags";
import { validCatalogVersion } from "@/lib/catalog";
import { ensureRuntimeInitialized, guardrailActive, installFlow, metricsFor } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeInitialized();
    const rows = await db.select().from(servers).orderBy(asc(servers.id));
    const allTags = await readAllServerTags();
    const output = [];
    for (const server of rows) {
      const metric = server.status === "online" ? (await metricsFor(server)).at(-1) : undefined;
      output.push({
        ...server,
        // Passwords never leave the server process.
        serverPassword: server.serverPassword ? "••••••••" : "",
        adminPassword: server.adminPassword ? "••••••••" : "",
        game: summarize(server.gameId),
        live: metric ? { cpu: metric.cpu, ram: metric.ram, players: metric.players, tps: metric.tps } : null,
        guardrail: guardrailActive(server.id),
        tags: allTags[String(server.id)] ?? [],
      });
    }
    return NextResponse.json({ servers: output });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

function summarize(gameId: string) {
  const game = getGame(gameId);
  return { id: game.id, name: game.name, short: game.short, accent: game.accent, art: game.art, protocol: game.protocol };
}

type CreateBody = Partial<{
  gameId: string;
  name: string;
  version: string;
  loader: string;
  port: number;
  bindAddress: string;
  publicAddress: string;
  readinessTimeoutSec: number;
  memoryMb: number;
  maxPlayers: number;
  motd: string;
  worldName: string;
  seed: string;
  difficulty: string;
  pvp: boolean;
  launchCommand: string;
  launchArgs: string;
  workingDirectory: string;
  serverPassword: string;
  adminPassword: string;
  ownerId: string;
  eulaAccepted: boolean;
}>;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateBody;
    if (!body.gameId || !hasGame(body.gameId)) return NextResponse.json({ error: "Unknown game" }, { status: 400 });
    const game = getGame(body.gameId);
    const name = (body.name ?? "").trim();
    if (!name || name.length > 60) return NextResponse.json({ error: "Server name is required (max 60 characters)" }, { status: 400 });
    const port = Number(body.port ?? game.defaultPort);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return NextResponse.json({ error: "Port must be between 1024 and 65535" }, { status: 400 });
    const others = await db.select({ port: servers.port }).from(servers);
    if (others.some((other) => other.port === port)) return NextResponse.json({ error: `Port ${port} is already assigned to another server` }, { status: 409 });

    const minecraft = game.installer === "mojang" || game.installer === "fabric";
    if (minecraft && body.eulaAccepted !== true) {
      return NextResponse.json({ error: "You must accept the Minecraft EULA to install this server" }, { status: 400 });
    }
    if (game.requiresPassword && (!body.serverPassword || body.serverPassword.length < 5)) {
      return NextResponse.json({ error: `${game.name} requires a password of at least five characters` }, { status: 400 });
    }
    if (game.id === "dragonwilds") {
      if (name.length > 16) return NextResponse.json({ error: "Dragonwilds server names are limited to 16 characters" }, { status: 400 });
      if (!(body.ownerId ?? "").trim()) return NextResponse.json({ error: "Dragonwilds requires your in-game Player ID" }, { status: 400 });
      if ((body.adminPassword ?? "").length < 5) return NextResponse.json({ error: "Dragonwilds requires an admin password of at least five characters" }, { status: 400 });
      if ((body.worldName ?? "world").trim().length > 16) return NextResponse.json({ error: "Dragonwilds world names are limited to 16 characters" }, { status: 400 });
    }

    const launchCommand = (body.launchCommand ?? "").trim();
    const launchArgs = (body.launchArgs ?? "").trim();
    const workingDirectory = (body.workingDirectory ?? "").trim();
    if (game.installer === "manual" && !launchCommand) return NextResponse.json({ error: "A launch command is required for a manual server" }, { status: 400 });
    if (launchCommand.length > 2_000 || launchArgs.length > 8_000 || workingDirectory.length > 2_000) {
      return NextResponse.json({ error: "Launch configuration is too long" }, { status: 400 });
    }
    if (workingDirectory && (!path.isAbsolute(workingDirectory) || !fs.existsSync(workingDirectory))) {
      return NextResponse.json({ error: "Working directory must be an existing absolute folder" }, { status: 400 });
    }

    const requestedVersion = (body.version ?? "").trim();
    const version = requestedVersion && validCatalogVersion(game.id, requestedVersion) ? requestedVersion : game.versions[0];
    const loader = body.loader && game.loaders?.some((item) => item.id === body.loader) ? body.loader : "vanilla";
    const memoryMb = Math.min(game.maxMemory, Math.max(game.minMemory, Math.round(Number(body.memoryMb ?? game.defaultMemory))));
    const maxPlayers = Math.min(game.maxPlayersCap, Math.max(1, Math.round(Number(body.maxPlayers ?? game.defaultMaxPlayers))));
    const [server] = await db.insert(servers).values({
      name,
      gameId: game.id,
      version,
      loader,
      status: "installing",
      port,
      bindAddress: (body.bindAddress ?? "192.168.1.210").trim(),
      publicAddress: (body.publicAddress ?? "185.83.148.20").trim().slice(0, 253),
      readinessTimeoutSec: Math.min(300, Math.max(10, Math.round(body.readinessTimeoutSec ?? 60))),
      memoryMb,
      maxPlayers,
      motd: (body.motd ?? "A Server Hub server").slice(0, 140),
      worldName: (body.worldName ?? "").trim().slice(0, 80) || "world",
      seed: (body.seed ?? "").slice(0, 200),
      difficulty: ["peaceful", "easy", "normal", "hard"].includes(body.difficulty ?? "") ? body.difficulty! : "normal",
      pvp: body.pvp ?? true,
      launchCommand,
      launchArgs,
      workingDirectory,
      managedDirectory: !workingDirectory,
      serverPassword: await protectAndVerify((body.serverPassword ?? "").slice(0, 200)),
      adminPassword: await protectAndVerify((body.adminPassword ?? "").slice(0, 200)),
      ownerId: await protectAndVerify((body.ownerId ?? "").trim().slice(0, 200)),
      eulaAccepted: body.eulaAccepted === true,
    }).returning();
    await installFlow(server.id);
    return NextResponse.json({
      server: {
        ...server,
        serverPassword: server.serverPassword ? "••••••••" : "",
        adminPassword: server.adminPassword ? "••••••••" : "",
      },
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
