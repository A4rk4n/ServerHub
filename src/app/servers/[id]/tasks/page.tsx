import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { TasksManager } from "@/components/tasks-manager";
import { RestartWarningsPanel } from "@/components/restart-warnings-panel";

export const dynamic = "force-dynamic";

export default async function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) notFound();
  const g = getGame(s.gameId);
  return (
    <div className="space-y-4">
      <TasksManager serverId={s.id} accent={g.accent} />
      <RestartWarningsPanel serverId={s.id} accent={g.accent} />
    </div>
  );
}
