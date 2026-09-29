import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { DiagnosticsManager } from "@/components/diagnostics-manager";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
export const dynamic="force-dynamic";
export default async function DiagnosticsPage({params}:{params:Promise<{id:string}>}){const {id}=await params;const [server]=await db.select().from(servers).where(eq(servers.id,Number(id)));if(!server)notFound();return <DiagnosticsManager serverId={server.id} accent={getGame(server.gameId).accent}/>}
