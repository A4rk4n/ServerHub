import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import {
  BANLIST_ACTIONS,
  banlistCommand,
  parseBanList,
  parseIpBanList,
  removeBan,
  removeIpBan,
  upsertBan,
  upsertIpBan,
  validBanIp,
  type BanlistAction,
} from "@/lib/banlist";
import { readServerFile, writeServerFile } from "@/lib/filesys";
import { isMinecraftJava, offlineUuid, validMinecraftName } from "@/lib/roster";
import { act, logLine, runCommand } from "@/lib/runtime";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

async function readText(server: NonNullable<Awaited<ReturnType<typeof loadServer>>>, relative: string): Promise<string | null> {
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
  const bans = parseBanList(await readText(server, "banned-players.json"));
  const ipBans = parseIpBanList(await readText(server, "banned-ips.json"));
  return NextResponse.json({ supported: true, live: server.status === "online", bans, ipBans });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isMinecraftJava(server.gameId)) {
    return NextResponse.json({ error: "Ban lists are only available for Minecraft Java servers" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: string; name?: string; ip?: string; reason?: string };
  const action = body.action as BanlistAction | undefined;
  if (!action || !BANLIST_ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const reason = (body.reason ?? "").trim().slice(0, 200);
  const isIpAction = action === "ban-ip" || action === "pardon-ip";
  const target = isIpAction ? (body.ip ?? "").trim() : (body.name ?? "").trim();
  if (isIpAction && !validBanIp(target)) return NextResponse.json({ error: "That does not look like an IP address" }, { status: 400 });
  if (!isIpAction && !validMinecraftName(target)) {
    return NextResponse.json({ error: "Player names are 3–16 letters, digits, or underscores" }, { status: 400 });
  }

  try {
    // Live server: the console is authoritative — the game resolves real
    // account UUIDs, kicks affected players, and rewrites its own files.
    if (server.status === "online") {
      const result = await runCommand(server, banlistCommand(action, target, reason), "Banlist");
      if (result.ok) {
        await act(server.id, "settings", `Ban list: ${action} ${target} on ${server.name} (console)`);
        return NextResponse.json({ ok: true, mode: "console" });
      }
      // Fall through to file edits if the process vanished mid-request.
    }

    // Offline: edit the ban files directly, in vanilla's own format.
    let changed = false;
    if (action === "ban" || action === "pardon") {
      const current = parseBanList(await readText(server, "banned-players.json"));
      const next = action === "ban" ? upsertBan(current, target, offlineUuid(target), reason) : removeBan(current, target);
      changed = next.changed;
      if (changed) await writeServerFile(server, "banned-players.json", `${JSON.stringify(next.list, null, 2)}\n`);
    } else {
      const current = parseIpBanList(await readText(server, "banned-ips.json"));
      const next = action === "ban-ip" ? upsertIpBan(current, target, reason) : removeIpBan(current, target);
      changed = next.changed;
      if (changed) await writeServerFile(server, "banned-ips.json", `${JSON.stringify(next.list, null, 2)}\n`);
    }
    if (changed) {
      await logLine(server.id, "system", "Banlist", `${action} ${target} applied to ban files (server offline).`);
      await act(server.id, "settings", `Ban list: ${action} ${target} on ${server.name} (files)`);
    }
    return NextResponse.json({ ok: true, mode: "files", changed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
