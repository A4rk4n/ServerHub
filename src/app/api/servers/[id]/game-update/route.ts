import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { appManifestName, compareBuilds, fetchLatestGameBuild, parseAppManifestBuildId } from "@/lib/game-updates";
import { getGame } from "@/lib/games";
import { serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const game = getGame(server.gameId);
  if (game.installer !== "steamcmd" || !game.steamAppId) {
    return NextResponse.json({ status: "not-applicable" });
  }
  const manifest = path.join(serverDir(server), "steamapps", appManifestName(game.steamAppId));
  const installedBuild = await fsp
    .readFile(manifest, "utf8")
    .then(parseAppManifestBuildId)
    .catch(() => null);
  const latest = await fetchLatestGameBuild(game.steamAppId);
  return NextResponse.json({
    status: compareBuilds(installedBuild, latest?.buildId ?? null),
    installedBuild,
    latestBuild: latest?.buildId ?? null,
    latestUpdatedAt: latest?.timeUpdated ? new Date(Number(latest.timeUpdated) * 1000).toISOString() : null,
    checkedAt: new Date().toISOString(),
  });
}
