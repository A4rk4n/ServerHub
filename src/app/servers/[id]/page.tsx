import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { ConsoleView } from "@/components/console-view";

export const dynamic = "force-dynamic";

export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const num = Number(id);
  const [s] = await db.select().from(servers).where(eq(servers.id, num));
  if (!s) notFound();
  const g = getGame(s.gameId);
  return (
    <ConsoleView
      serverId={s.id}
      accent={g.accent}
      protocol={g.protocol}
      port={s.port}
      memoryMb={s.memoryMb}
      gameId={s.gameId}
      isMc={s.gameId.startsWith("minecraft")}
    />
  );
}
