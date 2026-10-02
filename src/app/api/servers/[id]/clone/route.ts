import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { act, cloneServerFiles } from "@/lib/runtime";
import { CLONE_EXCLUDED, CONFIG_ONLY_EXCLUDED, canCopyFiles, cloneWorldName, pickClonePort, resolveCloneName } from "@/lib/server-clone";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [source] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!source) return NextResponse.json({ error: "Server not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { name: requestedName, port: requestedPort, copyFiles } = (body ?? {}) as { name?: unknown; port?: unknown; copyFiles?: unknown };

  const name = resolveCloneName(requestedName, source.name);
  if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });

  const withFiles = copyFiles === true;
  if (withFiles && !canCopyFiles(source.status)) {
    return NextResponse.json({ error: "Stop the server before cloning its files — copying a live directory can tear the world mid-write." }, { status: 409 });
  }

  const fleet = await db.select({ port: servers.port }).from(servers);
  const port = pickClonePort(source.port, fleet.map((row) => row.port), requestedPort);
  if (!port.ok) return NextResponse.json({ error: port.error }, { status: port.status });

  const [clone] = await db.insert(servers).values({
    name: name.name,
    gameId: source.gameId,
    version: source.version,
    loader: source.loader,
    // Config-only clones must be reinstalled; a file clone brings the
    // server files along and is ready to start.
    status: withFiles ? "offline" : "error",
    port: port.port,
    bindAddress: source.bindAddress,
    publicAddress: source.publicAddress,
    readinessTimeoutSec: source.readinessTimeoutSec,
    memoryMb: source.memoryMb,
    maxPlayers: source.maxPlayers,
    motd: source.motd,
    worldName: cloneWorldName(source.worldName, withFiles),
    seed: source.seed,
    difficulty: source.difficulty,
    pvp: source.pvp,
    autoRestart: source.autoRestart,
    maxCrashRestarts: source.maxCrashRestarts,
    restartWindowSec: source.restartWindowSec,
    autoBackupBeforeUpdate: source.autoBackupBeforeUpdate,
    updateBackupRetention: source.updateBackupRetention,
    backupRetentionCount: source.backupRetentionCount,
    backupRetentionDays: source.backupRetentionDays,
    managedDirectory: true,
    serverPassword: "",
    adminPassword: "",
    ownerId: "",
    eulaAccepted: source.eulaAccepted,
    launchCommand: source.launchCommand,
  }).returning();

  let copiedFiles: number | null = null;
  if (withFiles) {
    try {
      copiedFiles = (await cloneServerFiles(source, clone)).files;
    } catch (error) {
      // The copy failed midway — remove the half-clone rather than leaving a trap.
      await db.delete(servers).where(eq(servers.id, clone.id));
      return NextResponse.json({ error: `File copy failed: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 });
    }
  }

  await act(clone.id, "server", `${source.name} cloned to "${clone.name}" on port ${clone.port}${withFiles ? ` with ${copiedFiles} files` : " (configuration only)"}`);
  return NextResponse.json({
    server: clone,
    copiedFiles,
    excluded: withFiles ? [...CLONE_EXCLUDED] : [...CLONE_EXCLUDED, ...CONFIG_ONLY_EXCLUDED],
  }, { status: 201 });
}
