import { NextResponse } from "next/server";
import { desc, like } from "drizzle-orm";
import { db } from "@/db";
import { activity, backups, players, servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { GROUP_LIMITS, bestScore, normalizeQuery, rankGroup, scoreMatch, type SearchHit } from "@/lib/fleet-search";

export const dynamic = "force-dynamic";

const EMPTY = { servers: [], players: [], backups: [], activity: [] };

export async function GET(req: Request) {
  const query = normalizeQuery(new URL(req.url).searchParams.get("q"));
  if (!query) return NextResponse.json({ query: "", results: EMPTY, total: 0 });

  const fleet = await db.select().from(servers);
  const nameOf = new Map(fleet.map((server) => [server.id, server.name]));

  const serverHits = rankGroup(
    fleet.map((server): SearchHit => ({
      type: "server",
      id: server.id,
      title: server.name,
      subtitle: `${getGame(server.gameId).name} · port ${server.port} · ${server.status}`,
      href: `/servers/${server.id}`,
      score: bestScore(query, [server.name, getGame(server.gameId).name, server.gameId, server.version, String(server.port)]),
      at: server.updatedAt?.getTime() ?? 0,
    })),
    GROUP_LIMITS.server
  );

  const playerRows = await db.select().from(players);
  const playerHits = rankGroup(
    playerRows.map((player): SearchHit => ({
      type: "player",
      id: player.id,
      title: player.name,
      subtitle: `${nameOf.get(player.serverId) ?? "unknown server"} · ${player.isOnline ? "online now" : "offline"}${player.isBanned ? " · banned" : ""}`,
      href: `/servers/${player.serverId}/players`,
      // The note is searchable too ("griefer", "friend of…"), name ranks higher naturally.
      score: bestScore(query, [player.name, player.notes]),
      at: player.lastSeen?.getTime() ?? 0,
    })),
    GROUP_LIMITS.player
  );

  const backupRows = await db.select().from(backups);
  const backupHits = rankGroup(
    backupRows.map((backup): SearchHit => ({
      type: "backup",
      id: backup.id,
      title: backup.name,
      subtitle: `${nameOf.get(backup.serverId) ?? "unknown server"} · ${backup.sizeMb} MB · ${backup.status}`,
      href: `/servers/${backup.serverId}/backups`,
      score: bestScore(query, [backup.name, backup.note]),
      at: backup.createdAt?.getTime() ?? 0,
    })),
    GROUP_LIMITS.backup
  );

  // Activity can be huge: pre-filter in SQL (LIKE is ASCII case-insensitive
  // in SQLite), newest first, bounded — then score for ordering.
  const activityRows = await db
    .select()
    .from(activity)
    .where(like(activity.message, `%${query.replaceAll("%", "").replaceAll("_", "")}%`))
    .orderBy(desc(activity.id))
    .limit(200);
  const activityHits = rankGroup(
    activityRows.map((row): SearchHit => ({
      type: "activity",
      id: row.id,
      title: row.message,
      subtitle: `${row.serverId ? nameOf.get(row.serverId) ?? "deleted server" : "panel"} · ${row.kind}`,
      href: "/audit",
      score: scoreMatch(query, row.message),
      at: row.ts?.getTime() ?? 0,
    })),
    GROUP_LIMITS.activity
  );

  const results = { servers: serverHits, players: playerHits, backups: backupHits, activity: activityHits };
  const total = serverHits.length + playerHits.length + backupHits.length + activityHits.length;
  return NextResponse.json({ query, results, total });
}
