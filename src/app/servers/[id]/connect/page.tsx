import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ConnectionManager } from "@/components/connection-manager";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
export const dynamic="force-dynamic";
export default async function ConnectionPage({params}:{params:Promise<{id:string}>}){const {id}=await params;const [server]=await db.select().from(servers).where(eq(servers.id,Number(id)));if(!server)notFound();const game=getGame(server.gameId);return <ConnectionManager server={server} game={{name:game.name,protocol:game.protocol,queryPort:game.queryPort}}/>}
