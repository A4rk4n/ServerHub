import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { SettingsManager } from "@/components/settings-manager";
import { TagsEditor } from "@/components/tags-editor";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [s] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!s) notFound();
  const g = getGame(s.gameId);
  const plain = JSON.parse(JSON.stringify({ ...s, serverPassword: s.serverPassword ? "••••••••" : "" })) as typeof s;
  return (
    <div className="space-y-4">
      <SettingsManager
        initial={plain}
        game={{
          accent: g.accent,
          minMemory: g.minMemory,
          maxMemory: g.maxMemory,
          maxPlayersCap: g.maxPlayersCap,
          difficulty: g.difficulty,
          short: g.short,
          protocol: g.protocol,
          installer: g.installer,
          requiresPassword: Boolean(g.requiresPassword),
        }}
      />
      <TagsEditor serverId={s.id} accent={g.accent} />
    </div>
  );
}
