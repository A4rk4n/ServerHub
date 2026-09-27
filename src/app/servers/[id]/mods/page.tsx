import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { AddonsManager } from "@/components/addons-manager";

export const dynamic = "force-dynamic";

export default async function ModsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) notFound();
  const g = getGame(s.gameId);
  if (!g.supportsMods) redirect(`/servers/${s.id}`);
  const label = g.id === "minecraft" || g.id === "rust" ? "Plugins" : g.modSource?.includes("Workshop") ? "Workshop" : "Mods";
  return <AddonsManager serverId={s.id} accent={g.accent} label={label} status={s.status} />;
}
