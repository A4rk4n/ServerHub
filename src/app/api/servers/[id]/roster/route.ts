import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { players, servers } from "@/db/schema";
import { readServerFile, writeServerFile } from "@/lib/filesys";
import {
  DEFAULT_OP_LEVEL,
  ROSTER_ACTIONS,
  actionNeedsName,
  isMinecraftJava,
  offlineUuid,
  parseRosterFile,
  readWhitelistEnabled,
  removeOp,
  removeWhitelist,
  rosterCommands,
  setWhitelistEnabled,
  upsertOp,
  upsertWhitelist,
  validMinecraftName,
  type OpsEntry,
  type RosterAction,
  type WhitelistEntry,
} from "@/lib/roster";
import { act, logLine, runCommand } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

async function readRosterText(server: NonNullable<Awaited<ReturnType<typeof loadServer>>>, relative: string): Promise<string | null> {
  try {
    const file = await readServerFile(server, relative);
    return file.editable ? file.content : null;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isMinecraftJava(server.gameId)) return NextResponse.json({ supported: false });
  const whitelist = parseRosterFile<WhitelistEntry>(await readRosterText(server, "whitelist.json"));
  const ops = parseRosterFile<OpsEntry>(await readRosterText(server, "ops.json"));
  const whitelistEnabled = readWhitelistEnabled(await readRosterText(server, "server.properties"));
  const roster = await db.select().from(players).where(eq(players.serverId, server.id)).orderBy(desc(players.lastSeen)).limit(50);
  const listed = new Set([...whitelist, ...ops].map((entry) => entry.name.toLowerCase()));
  const knownPlayers = [...new Set(roster.map((p) => p.name))].filter((name) => validMinecraftName(name) && !listed.has(name.toLowerCase())).slice(0, 20);
  return NextResponse.json({
    supported: true,
    live: server.status === "online",
    whitelist,
    ops,
    whitelistEnabled,
    knownPlayers,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isMinecraftJava(server.gameId)) return NextResponse.json({ error: "Whitelist and ops are only available for Minecraft Java servers" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; name?: string };
  const action = body.action as RosterAction | undefined;
  if (!action || !ROSTER_ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const name = (body.name ?? "").trim();
  if (actionNeedsName(action) && !validMinecraftName(name)) {
    return NextResponse.json({ error: "Player names are 3–16 letters, digits, or underscores" }, { status: 400 });
  }

  try {
    // Live server: the console is authoritative — the game resolves the real
    // account UUID and rewrites its own roster files.
    if (server.status === "online") {
      let delivered = true;
      for (const command of rosterCommands(action, name)) {
        const result = await runCommand(server, command, "Roster");
        if (!result.ok) {
          delivered = false;
          break;
        }
      }
      if (delivered) {
        await act(server.id, "settings", `Roster: ${action}${name ? ` ${name}` : ""} on ${server.name} (console)`);
        return NextResponse.json({ ok: true, mode: "console" });
      }
      // Fall through to file edits if the process vanished mid-request.
    }

    // Offline: edit the JSON roster files / server.properties directly.
    let changed = false;
    if (action === "whitelist-add" || action === "whitelist-remove") {
      const current = parseRosterFile<WhitelistEntry>(await readRosterText(server, "whitelist.json"));
      const next = action === "whitelist-add" ? upsertWhitelist(current, name, offlineUuid(name)) : removeWhitelist(current, name);
      changed = next.changed;
      if (changed) await writeServerFile(server, "whitelist.json", `${JSON.stringify(next.list, null, 2)}\n`);
    } else if (action === "op" || action === "deop") {
      const current = parseRosterFile<OpsEntry>(await readRosterText(server, "ops.json"));
      const next = action === "op" ? upsertOp(current, name, offlineUuid(name), DEFAULT_OP_LEVEL) : removeOp(current, name);
      changed = next.changed;
      if (changed) await writeServerFile(server, "ops.json", `${JSON.stringify(next.list, null, 2)}\n`);
    } else {
      const enabled = action === "whitelist-on";
      const properties = await readRosterText(server, "server.properties");
      const alreadySet = readWhitelistEnabled(properties) === enabled;
      changed = !alreadySet;
      if (changed) await writeServerFile(server, "server.properties", setWhitelistEnabled(properties, enabled));
    }
    if (changed) {
      await logLine(server.id, "system", "Roster", `${action}${name ? ` ${name}` : ""} applied to roster files (server offline).`);
      await act(server.id, "settings", `Roster: ${action}${name ? ` ${name}` : ""} on ${server.name} (files)`);
    }
    return NextResponse.json({ ok: true, mode: "files", changed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
