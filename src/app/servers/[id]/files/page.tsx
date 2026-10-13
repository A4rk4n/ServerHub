import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { DiskUsagePanel } from "@/components/disk-usage-panel";
import { FilesManager } from "@/components/files-manager";

export const dynamic = "force-dynamic";

export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) notFound();
  const g = getGame(s.gameId);
  return (
    <div className="space-y-4">
      <FilesManager serverId={s.id} accent={g.accent} status={s.status} />
      <DiskUsagePanel serverId={s.id} accent={g.accent} />
    </div>
  );
}
