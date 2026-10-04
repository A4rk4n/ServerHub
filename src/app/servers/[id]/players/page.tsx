import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { isMinecraftJava } from "@/lib/roster";
import { PlayersManager } from "@/components/players-manager";
import { RosterManager } from "@/components/roster-manager";

export const dynamic = "force-dynamic";

export default async function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) notFound();
  const g = getGame(s.gameId);
  return (
    <div className="space-y-4">
      {isMinecraftJava(s.gameId) && <RosterManager serverId={s.id} accent={g.accent} />}
      <PlayersManager serverId={s.id} accent={g.accent} />
    </div>
  );
}
