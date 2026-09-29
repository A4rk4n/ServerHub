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
 const adapters=Object.entries(os.networkInterfaces()).flatMap(([name,items])=>(items??[]).filter(item=>item.family==="IPv4"&&!item.internal).map(item=>({name,address:item.address,netmask:item.netmask})));
 const bindAssigned=adapters.some(item=>item.address===server.bindAddress)||["0.0.0.0","127.0.0.1"].includes(server.bindAddress);
 const ports=[{name:"Game",port:server.port,protocol:game.protocol,required:true},...(game.queryPort&&game.queryPort!==server.port?[{name:"Query",port:game.queryPort,protocol:"UDP",required:true}]:[])];
 const running=["online","starting","restarting"].includes(server.status);
 const checklist=[
  {id:"bind",label:"Bind address assigned to this PC",ok:bindAssigned,fix:"Choose one of the detected LAN adapters in Settings."},
  {id:"public",label:"Public player address configured",ok:Boolean(server.publicAddress),fix:"Enter the public IP or hostname in Settings."},
  {id:"install",label:"Installation completed",ok:jobs[0]?.status==="succeeded"||running,fix:"Run Repair and retry."},
  {id:"ready",label:"Server ready for players",ok:server.status==="online",fix:"Start the server and review its readiness result."},
  {id:"backup",label:"Recovery policy available",ok:true,fix:"Configure scheduled backups."},
 ];
 const report={generatedAt:new Date().toISOString(),application:"Server Hub",platform:{os:os.platform(),release:os.release(),arch:os.arch(),node:process.version,cpuCount:os.cpus().length,totalMemoryMb:Math.round(os.totalmem()/1048576),freeMemoryMb:Math.round(os.freemem()/1048576)},network:{adapters,lanEndpoint:`${server.bindAddress}:${server.port}`,publicEndpoint:`${server.publicAddress}:${server.port}`,ports,routerTarget:server.bindAddress},server:{id:server.id,name:server.name,game:game.name,version:server.version,status:server.status,bindAddress:server.bindAddress,publicAddress:server.publicAddress,port:server.port,protocol:game.protocol,workingDirectory:server.managedDirectory?"managed":"external",passwordConfigured:Boolean(server.serverPassword),adminPasswordConfigured:Boolean(server.adminPassword),ownerConfigured:Boolean(server.ownerId)},checks:{bindAddressAssigned:bindAssigned,bindAddressAvailable:await portAvailable(server.port,game.protocol,server.bindAddress),diskFreeMb:stat?Math.round(Number(stat.bavail)*Number(stat.bsize)/1048576):null,checklist},jobs,logs:logs.map(line=>({...line,message:redactLogSecrets(line.message)}))};
 if(new URL(request.url).searchParams.get("download")==="1")return new Response(JSON.stringify(report,null,2),{headers:{"content-type":"application/json","content-disposition":`attachment; filename="serverhub-diagnostics-${server.id}.json"`}});
 return NextResponse.json(report);
}
