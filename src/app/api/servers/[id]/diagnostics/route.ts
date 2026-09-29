import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { consoleLogs, incidents, installationJobs, servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { portAvailable, redactLogSecrets } from "@/lib/runtime";
import { serverDir, toolsDir } from "@/lib/storage";
export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
 const {id}=await context.params; const [server]=await db.select().from(servers).where(eq(servers.id,Number(id))); if(!server)return NextResponse.json({error:"Not found"},{status:404});
 const game=getGame(server.gameId); const incidentRows=await db.select().from(incidents).where(eq(incidents.serverId,server.id)).orderBy(desc(incidents.id)).limit(50); const stat=await fsp.statfs(serverDir(server)).catch(()=>null); const logs=await db.select().from(consoleLogs).where(eq(consoleLogs.serverId,server.id)).orderBy(desc(consoleLogs.id)).limit(100); const jobs=await db.select().from(installationJobs).where(eq(installationJobs.serverId,server.id)).orderBy(desc(installationJobs.id)).limit(10);
 const adapters=Object.entries(os.networkInterfaces()).flatMap(([name,items])=>(items??[]).filter(item=>item.family==="IPv4"&&!item.internal).map(item=>({name,address:item.address,netmask:item.netmask})));
 const bindAssigned=adapters.some(item=>item.address===server.bindAddress)||["0.0.0.0","127.0.0.1"].includes(server.bindAddress);
 const ports=[{name:"Game",port:server.port,protocol:game.protocol,required:true},...(game.queryPort&&game.queryPort!==server.port?[{name:"Query",port:game.queryPort,protocol:"UDP",required:true}]:[])];
 const running=["online","starting","restarting"].includes(server.status);
 const steamcmd=path.join(toolsDir(),"steamcmd",process.platform==="win32"?"steamcmd.exe":"steamcmd.sh"); const hytale=path.join(toolsDir(),"hytale-downloader");
 const commandAvailable=async(command:string)=>{try{await execFileAsync(process.platform==="win32"?"where.exe":"which",[command],{windowsHide:true,timeout:3000});return true}catch{return false}};
 const tools=[{name:"SteamCMD",installed:await fsp.stat(steamcmd).then(x=>x.isFile()).catch(()=>false),path:steamcmd},{name:"PowerShell",installed:await commandAvailable("powershell.exe"),path:"system"},{name:"Java",installed:await commandAvailable("java.exe"),path:"system"},{name:"Hytale downloader",installed:await fsp.stat(hytale).then(()=>true).catch(()=>false),path:hytale},{name:"WebView2 Runtime",installed:process.platform==="win32",path:"Windows runtime"}];
 let firewallRules:string[]=[]; if(process.platform==="win32"){try{const {stdout}=await execFileAsync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",`Get-NetFirewallRule -DisplayName ${psQuote(`Server Hub — ${server.id} —*`)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DisplayName`],{windowsHide:true,timeout:5000});firewallRules=stdout.split(/\r?\n/).filter(Boolean)}catch{}}
 const checklist=[
  {id:"bind",label:"Bind address assigned to this PC",ok:bindAssigned,fix:"Choose one of the detected LAN adapters in Settings."},
  {id:"public",label:"Public player address configured",ok:Boolean(server.publicAddress),fix:"Enter the public IP or hostname in Settings."},
  {id:"install",label:"Installation completed",ok:jobs[0]?.status==="succeeded"||running,fix:"Run Repair and retry."},
  {id:"ready",label:"Server ready for players",ok:server.status==="online",fix:"Start the server and review its readiness result."},
  {id:"firewall",label:"Windows Firewall rules configured",ok:process.platform!=="win32"||firewallRules.length>=ports.length,fix:"Create/repair firewall rules below."},
  {id:"backup",label:"Recovery policy available",ok:true,fix:"Configure scheduled backups."},
 ];
 const report={generatedAt:new Date().toISOString(),application:"Server Hub",platform:{os:os.platform(),release:os.release(),arch:os.arch(),node:process.version,cpuCount:os.cpus().length,totalMemoryMb:Math.round(os.totalmem()/1048576),freeMemoryMb:Math.round(os.freemem()/1048576)},tools,firewall:{rules:firewallRules,configured:firewallRules.length>=ports.length},network:{adapters,lanEndpoint:`${server.bindAddress}:${server.port}`,publicEndpoint:`${server.publicAddress}:${server.port}`,ports,routerTarget:server.bindAddress},server:{id:server.id,name:server.name,game:game.name,version:server.version,status:server.status,healthStatus:server.healthStatus,healthReason:server.healthReason,healthProbe:server.healthProbe,healthFailures:server.healthFailures,bindAddress:server.bindAddress,publicAddress:server.publicAddress,port:server.port,protocol:game.protocol,workingDirectory:server.managedDirectory?"managed":"external",passwordConfigured:Boolean(server.serverPassword),adminPasswordConfigured:Boolean(server.adminPassword),ownerConfigured:Boolean(server.ownerId)},checks:{bindAddressAssigned:bindAssigned,bindAddressAvailable:await portAvailable(server.port,game.protocol,server.bindAddress),diskFreeMb:stat?Math.round(Number(stat.bavail)*Number(stat.bsize)/1048576):null,checklist},incidents:incidentRows,jobs,logs:logs.map(line=>({...line,message:redactLogSecrets(line.message)}))};
 if(new URL(request.url).searchParams.get("download")==="1")return new Response(JSON.stringify(report,null,2),{headers:{"content-type":"application/json","content-disposition":`attachment; filename="serverhub-diagnostics-${server.id}.json"`}});
 return NextResponse.json(report);
}

const execFileAsync=promisify(execFile);
function psQuote(value:string){return `'${value.replaceAll("'","''")}'`;}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 const {id}=await context.params; const [server]=await db.select().from(servers).where(eq(servers.id,Number(id))); if(!server)return NextResponse.json({error:"Not found"},{status:404});
 if(process.platform!=="win32")return NextResponse.json({error:"Windows Defender Firewall management is available on Windows only"},{status:409});
 const body=await request.json().catch(()=>({})) as {action?:string}; if(!["create","remove"].includes(body.action??""))return NextResponse.json({error:"Unknown firewall action"},{status:400});
 const game=getGame(server.gameId); const prefix=`Server Hub — ${server.id} —`; const ports=[{name:"Game",port:server.port,protocol:game.protocol},...(game.queryPort&&game.queryPort!==server.port?[{name:"Query",port:game.queryPort,protocol:"UDP"}]:[])];
 const commands=body.action==="remove"?[`Get-NetFirewallRule -DisplayName ${psQuote(prefix+"*")} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`]:ports.map(item=>`New-NetFirewallRule -DisplayName ${psQuote(`${prefix} ${item.name} ${item.protocol} ${item.port}`)} -Direction Inbound -Action Allow -Protocol ${item.protocol} -LocalPort ${item.port} -Profile Private -ErrorAction Stop`);
 const script=path.join(os.tmpdir(),`serverhub-firewall-${server.id}-${Date.now()}.ps1`); await fsp.writeFile(script,["$ErrorActionPreference='Stop'",`Get-NetFirewallRule -DisplayName ${psQuote(prefix+"*")} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,...(body.action==="create"?commands:[]),""].join("\r\n"));
 try { const command=`Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${psQuote(script)})`; await execFileAsync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",command],{windowsHide:true,timeout:120000}); return NextResponse.json({ok:true,action:body.action,rules:ports}); } catch(error){return NextResponse.json({error:`Firewall change was cancelled or failed: ${error instanceof Error?error.message:String(error)}`},{status:409});} finally {await fsp.rm(script,{force:true}).catch(()=>{});}
}
