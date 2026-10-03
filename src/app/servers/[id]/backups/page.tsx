import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { BackupsManager } from "@/components/backups-manager";
import { ExportPanel } from "@/components/export-panel";

export const dynamic = "force-dynamic";

export default async function BackupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) notFound();
  const g = getGame(s.gameId);
  return (
    <div className="space-y-4">
      <BackupsManager serverId={s.id} accent={g.accent} status={s.status} />
      <ExportPanel serverId={s.id} accent={g.accent} />
    </div>
  );
}
