import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { DiagnosticsManager } from "@/components/diagnostics-manager";
import { PreflightPanel } from "@/components/preflight-panel";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
export const dynamic="force-dynamic";
export default async function DiagnosticsPage({params}:{params:Promise<{id:string}>}){const {id}=await params;const [server]=await db.select().from(servers).where(eq(servers.id,Number(id)));if(!server)notFound();const accent=getGame(server.gameId).accent;return <div className="space-y-5"><PreflightPanel serverId={server.id} accent={accent}/><DiagnosticsManager serverId={server.id} accent={accent}/></div>}
