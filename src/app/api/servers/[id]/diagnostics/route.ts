import fsp from "node:fs/promises";
import os from "node:os";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { consoleLogs, installationJobs, servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { portAvailable, redactLogSecrets } from "@/lib/runtime";
import { serverDir } from "@/lib/storage";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
 const {id}=await context.params; const [server]=await db.select().from(servers).where(eq(servers.id,Number(id))); if(!server)return NextResponse.json({error:"Not found"},{status:404});
 const game=getGame(server.gameId); const stat=await fsp.statfs(serverDir(server)).catch(()=>null); const logs=await db.select().from(consoleLogs).where(eq(consoleLogs.serverId,server.id)).orderBy(desc(consoleLogs.id)).limit(100); const jobs=await db.select().from(installationJobs).where(eq(installationJobs.serverId,server.id)).orderBy(desc(installationJobs.id)).limit(10);
 const report={generatedAt:new Date().toISOString(),application:"Server Hub",platform:{os:os.platform(),release:os.release(),arch:os.arch(),node:process.version,cpuCount:os.cpus().length,totalMemoryMb:Math.round(os.totalmem()/1048576),freeMemoryMb:Math.round(os.freemem()/1048576)},server:{id:server.id,name:server.name,game:game.name,version:server.version,status:server.status,bindAddress:server.bindAddress,port:server.port,protocol:game.protocol,workingDirectory:server.managedDirectory?"managed":"external",passwordConfigured:Boolean(server.serverPassword)},checks:{bindAddressAvailable:await portAvailable(server.port,game.protocol,server.bindAddress),diskFreeMb:stat?Math.round(Number(stat.bavail)*Number(stat.bsize)/1048576):null},jobs,logs:logs.map(line=>({...line,message:redactLogSecrets(line.message)}))};
 if(new URL(request.url).searchParams.get("download")==="1")return new Response(JSON.stringify(report,null,2),{headers:{"content-type":"application/json","content-disposition":`attachment; filename="serverhub-diagnostics-${server.id}.json"`}});
 return NextResponse.json(report);
}
