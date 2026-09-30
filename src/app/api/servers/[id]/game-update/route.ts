import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { appManifestName, compareBuilds, extractLatestBuildId, parseAppManifestBuildId, steamAppInfoUrl } from "@/lib/game-updates";
import { getGame } from "@/lib/games";
import { serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Latest-build lookups are cached per Steam app (not per server): six
// hours on success, fifteen minutes on failure, keeping the community
// app-info mirror comfortable no matter how many panels poll.
const OK_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 15 * 60 * 1000;
const latestCache = new Map<number, { at: number; latest: { buildId: string; timeUpdated: string | null } | null }>();

async function latestBuild(appId: number) {
  const cached = latestCache.get(appId);
  const now = Date.now();
  if (cached && now - cached.at < (cached.latest ? OK_TTL_MS : FAIL_TTL_MS)) return cached.latest;
  let latest: { buildId: string; timeUpdated: string | null } | null = null;
  try {
    const response = await fetch(steamAppInfoUrl(appId), {
      headers: { Accept: "application/json", "User-Agent": "ServerHub-game-update-check" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (response.ok) latest = extractLatestBuildId(await response.json(), appId);
  } catch {
    /* mirror unreachable: report unknown, retry after FAIL_TTL */
  }
  latestCache.set(appId, { at: now, latest });
  return latest;
}

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
  const latest = await latestBuild(game.steamAppId);
  return NextResponse.json({
    status: compareBuilds(installedBuild, latest?.buildId ?? null),
    installedBuild,
    latestBuild: latest?.buildId ?? null,
    latestUpdatedAt: latest?.timeUpdated ? new Date(Number(latest.timeUpdated) * 1000).toISOString() : null,
    checkedAt: new Date().toISOString(),
  });
}
