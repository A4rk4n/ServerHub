import fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
const archiver = createRequire(import.meta.url)("archiver") as (format:"zip",options:{zlib:{level:number}})=>NodeJS.ReadWriteStream & {append:(content:string,options:{name:string})=>void;finalize:()=>Promise<void>};
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { consoleLogs, incidents, installationEvents, installationJobs, servers } from "@/db/schema";
import { isProtectedSecret } from "@/lib/credential-vault";
import { getGame } from "@/lib/games";
import { portAvailable, redactLogSecrets } from "@/lib/runtime";
import { appDataDir, serverDir, toolsDir } from "@/lib/storage";
export const dynamic="force-dynamic";
async function supportZip(entries:Record<string,string>){const zip=archiver("zip",{zlib:{level:9}});const chunks:Buffer[]=[];zip.on("data",(chunk:Buffer)=>chunks.push(Buffer.from(chunk)));const complete=new Promise<Buffer>((resolve,reject)=>{zip.once("end",()=>resolve(Buffer.concat(chunks)));zip.once("error",reject)});for(const [name,content] of Object.entries(entries))zip.append(content,{name});await zip.finalize();return complete;}
export async function GET(request:Request,context:{params:Promise<{id:string}>}) {
 const {id}=await context.params; const [server]=await db.select().from(servers).where(eq(servers.id,Number(id))); if(!server)return NextResponse.json({error:"Not found"},{status:404});
 const game=getGame(server.gameId); const incidentRows=await db.select().from(incidents).where(eq(incidents.serverId,server.id)).orderBy(desc(incidents.id)).limit(50); const stat=await fsp.statfs(serverDir(server)).catch(()=>null); const logs=await db.select().from(consoleLogs).where(eq(consoleLogs.serverId,server.id)).orderBy(desc(consoleLogs.id)).limit(500); const jobs=await db.select().from(installationJobs).where(eq(installationJobs.serverId,server.id)).orderBy(desc(installationJobs.id)).limit(10);
 const installEvents=await db.select().from(installationEvents).where(eq(installationEvents.serverId,server.id)).orderBy(desc(installationEvents.id)).limit(200);
 const adapters=Object.entries(os.networkInterfaces()).flatMap(([name,items])=>(items??[]).filter(item=>item.family==="IPv4"&&!item.internal).map(item=>({name,address:item.address,netmask:item.netmask})));
 const bindAssigned=adapters.some(item=>item.address===server.bindAddress)||["0.0.0.0","127.0.0.1"].includes(server.bindAddress);
 const ports=[{name:"Game",port:server.port,protocol:game.protocol,required:true},...(game.queryPort&&game.queryPort!==server.port?[{name:"Query",port:game.queryPort,protocol:"UDP",required:true}]:[])];
 const running=["online","starting","restarting"].includes(server.status);
 const steamcmd=path.join(toolsDir(),"steamcmd",process.platform==="win32"?"steamcmd.exe":"steamcmd.sh"); const hytale=path.join(toolsDir(),"hytale-downloader");
 const commandAvailable=async(command:string)=>{try{await execFileAsync(process.platform==="win32"?"where.exe":"which",[command],{windowsHide:true,timeout:3000});return true}catch{return false}};
 const commandVersion=async(command:string,args:string[])=>{try{const result=await execFileAsync(command,args,{windowsHide:true,timeout:5000});return `${result.stdout} ${result.stderr}`.trim().split(/\r?\n/)[0].slice(0,160)}catch{return "unavailable"}};
 const tools=[{name:"SteamCMD",installed:await fsp.stat(steamcmd).then(x=>x.isFile()).catch(()=>false),path:steamcmd,version:"managed"},{name:"PowerShell",installed:await commandAvailable("powershell.exe"),path:"system",version:process.platform==="win32"?await commandVersion("powershell.exe",["-NoProfile","-Command","$PSVersionTable.PSVersion.ToString()"]):"unavailable"},{name:"Java",installed:await commandAvailable("java.exe"),path:"system",version:await commandVersion(process.platform==="win32"?"java.exe":"java",["-version"])},{name:"Hytale downloader",installed:await fsp.stat(hytale).then(()=>true).catch(()=>false),path:hytale,version:"managed"},{name:"WebView2 Runtime",installed:process.platform==="win32",path:"Windows runtime",version:"system"}];
 const migrationMarker=await fsp.stat(path.join(appDataDir(),"credential-migration.json")).then(()=>true).catch(()=>false); const dataFiles=await fsp.readdir(path.dirname(process.env.SERVERHUB_DB||path.join(appDataDir(),"serverhub.db"))).catch(()=>[]); const recoveryBackupAvailable=dataFiles.some(name=>name.includes("pre-dpapi")&&name.endsWith(".bak")); const protectedValues=[server.serverPassword,server.adminPassword,server.ownerId].filter(Boolean); const vault={provider:"Windows DPAPI",scope:"Current Windows user",migrationComplete:!migrationMarker&&protectedValues.every(isProtectedSecret),recoveryBackupAvailable};
 let firewallRules:string[]=[]; if(process.platform==="win32"){try{const {stdout}=await execFileAsync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",`Get-NetFirewallRule -DisplayName ${psQuote(`Server Hub — ${server.id} —*`)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DisplayName`],{windowsHide:true,timeout:5000});firewallRules=stdout.split(/\r?\n/).filter(Boolean)}catch{}}
 const dragonRoot=serverDir(server); const dragonExecutable=server.gameId!=="dragonwilds"||await Promise.all(["RSDragonwilds.exe","RSDragonwildsServer.exe"].map(name=>fsp.stat(/*turbopackIgnore: true*/ path.join(dragonRoot,name)).then(()=>true).catch(()=>false))).then(values=>values.some(Boolean)); const dragonConfig=server.gameId!=="dragonwilds"||await fsp.stat(/*turbopackIgnore: true*/ path.join(dragonRoot,"RSDragonwilds","Saved","Config",process.platform==="win32"?"WindowsServer":"LinuxServer","DedicatedServer.ini")).then(()=>true).catch(()=>false);
 const checklist=[
  {id:"bind",label:"Bind address assigned to this PC",ok:bindAssigned,fix:"Choose one of the detected LAN adapters in Settings."},
  {id:"public",label:"Public player address configured",ok:Boolean(server.publicAddress),fix:"Enter the public IP or hostname in Settings."},
  {id:"install",label:"Installation completed",ok:jobs[0]?.status==="succeeded"||running,fix:"Run Repair and retry."},
  {id:"ready",label:"Server ready for players",ok:server.status==="online",fix:"Start the server and review its readiness result."},
  {id:"firewall",label:"Windows Firewall rules configured",ok:process.platform!=="win32"||firewallRules.length>=ports.length,fix:"Create/repair firewall rules below."},
  {id:"backup",label:"Recovery policy available",ok:true,fix:"Configure scheduled backups."},
  ...(server.gameId==="dragonwilds"?[{id:"dragon-exe",label:"Dragonwilds executable installed",ok:dragonExecutable,fix:"Run Repair and retry."},{id:"dragon-config",label:"Dragonwilds configuration generated",ok:dragonConfig,fix:"Retry installation to regenerate configuration."},{id:"dragon-owner",label:"Player/Owner ID protected",ok:Boolean(server.ownerId),fix:"Enter the in-game Player ID in Settings."},{id:"dragon-admin",label:"Admin password protected",ok:Boolean(server.adminPassword),fix:"Enter an admin password in Settings."},{id:"dragon-password",label:"World password protected",ok:Boolean(server.serverPassword),fix:"Enter a world password in Settings."}]:[]),
 ];
 const report={generatedAt:new Date().toISOString(),application:"Server Hub",vault,platform:{os:os.platform(),release:os.release(),arch:os.arch(),node:process.version,cpuCount:os.cpus().length,totalMemoryMb:Math.round(os.totalmem()/1048576),freeMemoryMb:Math.round(os.freemem()/1048576)},tools,firewall:{rules:firewallRules,configured:firewallRules.length>=ports.length},network:{adapters,lanEndpoint:`${server.bindAddress}:${server.port}`,publicEndpoint:`${server.publicAddress}:${server.port}`,ports,routerTarget:server.bindAddress},server:{id:server.id,name:server.name,game:game.name,version:server.version,status:server.status,healthStatus:server.healthStatus,healthReason:server.healthReason,healthProbe:server.healthProbe,healthFailures:server.healthFailures,bindAddress:server.bindAddress,publicAddress:server.publicAddress,port:server.port,protocol:game.protocol,workingDirectory:server.managedDirectory?"managed":"external",passwordConfigured:Boolean(server.serverPassword),adminPasswordConfigured:Boolean(server.adminPassword),ownerConfigured:Boolean(server.ownerId)},checks:{bindAddressAssigned:bindAssigned,bindAddressAvailable:await portAvailable(server.port,game.protocol,server.bindAddress),diskFreeMb:stat?Math.round(Number(stat.bavail)*Number(stat.bsize)/1048576):null,checklist},incidents:incidentRows,installationEvents:installEvents,jobs,logs:logs.map(line=>({...line,message:redactLogSecrets(line.message)}))};
 const params=new URL(request.url).searchParams;
 if(params.get("bundle")==="1"){
  const sanitize=(value:unknown)=>redactLogSecrets(JSON.stringify(value,null,2).replaceAll(os.homedir(),"<user-home>").replaceAll(path.dirname(serverDir(server)),"<server-storage>"));
  const entries:Record<string,string>={
   "summary.json":sanitize({generatedAt:report.generatedAt,application:report.application,server:report.server,checks:report.checks}),
   "diagnostics.json":sanitize(report),"readiness.json":sanitize({healthStatus:server.healthStatus,healthReason:server.healthReason,healthProbe:server.healthProbe,healthFailures:server.healthFailures,lastSuccess:server.lastHealthSuccessAt,lastFailure:server.lastHealthFailureAt}),
   "incidents.json":sanitize(incidentRows),"installation-events.json":sanitize(installEvents),
   "console-redacted.txt":logs.slice().reverse().map(line=>`${new Date(line.ts??0).toISOString()} [${line.level}] ${line.source}: ${redactLogSecrets(line.message)}`).join("\n"),
   "tool-health.json":sanitize(tools),"network.json":sanitize(report.network),"firewall.json":sanitize(report.firewall),
   "build-info.json":sanitize({node:process.version,platform:process.platform,arch:process.arch})
  };
  entries["SHA256SUMS"]=Object.entries(entries).map(([name,content])=>`${crypto.createHash("sha256").update(content).digest("hex")}  ${name}`).join("\n")+"\n";
  const zip=await supportZip(entries);return new Response(new Uint8Array(zip),{headers:{"content-type":"application/zip","content-disposition":`attachment; filename="serverhub-support-${server.id}.zip"`,"content-length":String(zip.length)}});
 }
 if(params.get("download")==="1")return new Response(JSON.stringify(report,null,2),{headers:{"content-type":"application/json","content-disposition":`attachment; filename="serverhub-diagnostics-${server.id}.json"`}});
 return NextResponse.json(report);
}

const execFileAsync=promisify(execFile);
function psQuote(value:string){return `'${value.replaceAll("'","''")}'`;}
export async function POST(request:Request,context:{params:Promise<{id:string}>}) {
 const {id}=await context.params; const [server]=await db.select().from(servers).where(eq(servers.id,Number(id))); if(!server)return NextResponse.json({error:"Not found"},{status:404});
 const body=await request.json().catch(()=>({})) as {action?:string;incidentId?:number};
 if(body.action==="resolve-incident"&&Number.isInteger(body.incidentId)){await db.update(incidents).set({resolved:true,resolvedAt:new Date()}).where(eq(incidents.id,body.incidentId!));return NextResponse.json({ok:true});}
 if(process.platform!=="win32")return NextResponse.json({error:"Windows Defender Firewall management is available on Windows only"},{status:409});
 if(!["create","remove"].includes(body.action??""))return NextResponse.json({error:"Unknown firewall action"},{status:400});
 const game=getGame(server.gameId); const prefix=`Server Hub — ${server.id} —`; const ports=[{name:"Game",port:server.port,protocol:game.protocol},...(game.queryPort&&game.queryPort!==server.port?[{name:"Query",port:game.queryPort,protocol:"UDP"}]:[])];
 const commands=body.action==="remove"?[`Get-NetFirewallRule -DisplayName ${psQuote(prefix+"*")} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`]:ports.map(item=>`New-NetFirewallRule -DisplayName ${psQuote(`${prefix} ${item.name} ${item.protocol} ${item.port}`)} -Direction Inbound -Action Allow -Protocol ${item.protocol} -LocalPort ${item.port} -Profile Private -ErrorAction Stop`);
 const script=path.join(os.tmpdir(),`serverhub-firewall-${server.id}-${Date.now()}.ps1`); await fsp.writeFile(script,["$ErrorActionPreference='Stop'",`Get-NetFirewallRule -DisplayName ${psQuote(prefix+"*")} -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,...(body.action==="create"?commands:[]),""].join("\r\n"));
 try { const command=`Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${psQuote(script)})`; await execFileAsync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",command],{windowsHide:true,timeout:120000}); return NextResponse.json({ok:true,action:body.action,rules:ports}); } catch(error){return NextResponse.json({error:`Firewall change was cancelled or failed: ${error instanceof Error?error.message:String(error)}`},{status:409});} finally {await fsp.rm(script,{force:true}).catch(()=>{});}
}
