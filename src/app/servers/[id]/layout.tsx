import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { ServerFrame } from "@/components/server-frame";

export const dynamic = "force-dynamic";

export default async function ServerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const num = Number(id);
  if (!Number.isInteger(num)) notFound();
  const [s] = await db.select().from(servers).where(eq(servers.id, num));
  if (!s) notFound();
  const g = getGame(s.gameId);
  const plain = JSON.parse(JSON.stringify(s)) as typeof s;
  return (
    <ServerFrame
      initial={plain}
      game={{ id: g.id, name: g.name, short: g.short, accent: g.accent, art: g.art, protocol: g.protocol, modSource: g.modSource ?? null, supportsMods: g.supportsMods }}
    >
      {children}
    </ServerFrame>
  );
}
