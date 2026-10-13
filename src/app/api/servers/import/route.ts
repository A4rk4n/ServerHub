import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { protectAndVerify } from "@/lib/credential-vault";
import { getGame, hasGame } from "@/lib/games";
import { act, ensureRuntimeInitialized } from "@/lib/runtime";
import { detectGameFromFiles, listImportCandidates, validateImportPath } from "@/lib/server-import";
import { appDataDir, managedServerDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

type ImportBody = Partial<{
  directory: string;
  name: string;
  port: number;
  gameId: string;
  launchCommand: string;
  launchArgs: string;
  eulaAccepted: boolean;
  serverPassword: string;
  adminPassword: string;
  ownerId: string;
}>;

// Adopt an existing server directory: the row points at the folder as-is
// (workingDirectory, unmanaged) with status offline — no installation ever
// runs against an adopted folder, and deleting the server later leaves the
// folder untouched.
export async function POST(request: Request) {
  try {
    await ensureRuntimeInitialized();
    const body = (await request.json()) as ImportBody;
    const directory = (body.directory ?? "").trim();
    const rows = await db.select().from(servers);
    const claimed = rows.map((row) => (row.managedDirectory ? managedServerDir(row.id) : row.workingDirectory)).filter(Boolean);
    const invalid = validateImportPath(directory, { appData: appDataDir(), claimed });
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const resolved = path.resolve(directory);
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) return NextResponse.json({ error: "That path does not exist or is not a folder" }, { status: 400 });

    const name = (body.name ?? "").trim();
    if (!name || name.length > 60) return NextResponse.json({ error: "Server name is required (max 60 characters)" }, { status: 400 });

    const detected = detectGameFromFiles(await listImportCandidates(resolved));
    const gameId = (body.gameId ?? detected ?? "custom").trim();
    if (!hasGame(gameId)) return NextResponse.json({ error: "Unknown game" }, { status: 400 });
    const game = getGame(gameId);
    const launchCommand = (body.launchCommand ?? "").trim();
    const launchArgs = (body.launchArgs ?? "").trim();
    if (launchCommand.length > 2_000 || launchArgs.length > 8_000) return NextResponse.json({ error: "Launch configuration is too long" }, { status: 400 });
    if (gameId === "custom" && !launchCommand) {
      return NextResponse.json({ error: "No known game was detected in that folder — provide a launch command to adopt it as a custom server" }, { status: 400 });
    }
    const minecraft = game.installer === "mojang" || game.installer === "fabric";
    if (minecraft && body.eulaAccepted !== true) {
      return NextResponse.json({ error: "You must accept the Minecraft EULA to adopt this server" }, { status: 400 });
    }
    if (game.requiresPassword && (!body.serverPassword || body.serverPassword.length < 5)) {
      return NextResponse.json({ error: `${game.name} requires a password of at least five characters` }, { status: 400 });
    }
    if (gameId === "dragonwilds") {
      if (!(body.ownerId ?? "").trim()) return NextResponse.json({ error: "Dragonwilds requires your in-game Player ID" }, { status: 400 });
      if ((body.adminPassword ?? "").length < 5) return NextResponse.json({ error: "Dragonwilds requires an admin password of at least five characters" }, { status: 400 });
    }

    const port = Number(body.port ?? game.defaultPort);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return NextResponse.json({ error: "Port must be between 1024 and 65535" }, { status: 400 });
    if (rows.some((other) => other.port === port)) return NextResponse.json({ error: `Port ${port} is already assigned to another server` }, { status: 409 });

    const [server] = await db.insert(servers).values({
      name,
      gameId,
      version: game.versions[0],
      loader: "vanilla",
      status: "offline",
      port,
      bindAddress: "192.168.1.210",
      publicAddress: "185.83.148.20",
      memoryMb: game.defaultMemory,
      maxPlayers: game.defaultMaxPlayers,
      motd: "Adopted by Server Hub",
      worldName: "world",
      launchCommand,
      launchArgs,
      workingDirectory: resolved,
      managedDirectory: false,
      serverPassword: await protectAndVerify((body.serverPassword ?? "").slice(0, 200)),
      adminPassword: await protectAndVerify((body.adminPassword ?? "").slice(0, 200)),
      ownerId: await protectAndVerify((body.ownerId ?? "").trim().slice(0, 200)),
      eulaAccepted: body.eulaAccepted === true,
    }).returning();
    await act(server.id, "install", `${server.name} adopted from ${resolved} (${game.name})`).catch(() => {});
    return NextResponse.json({
      server: { ...server, serverPassword: server.serverPassword ? "••••••••" : "", adminPassword: server.adminPassword ? "••••••••" : "" },
      detected,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
