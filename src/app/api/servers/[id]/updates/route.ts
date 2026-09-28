import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { catalogVersions, serverCatalog } from "@/lib/catalog";
import { getGame } from "@/lib/games";
import { installFlow } from "@/lib/runtime";
export const dynamic = "force-dynamic";

async function load(id: number) { return (await db.select().from(servers).where(eq(servers.id,id)))[0]; }

export async function GET(_request: Request, context: {params: Promise<{id:string}>}) {
  const {id}=await context.params; const server=await load(Number(id));
  if(!server) return NextResponse.json({error:"Not found"},{status:404});
  const game=getGame(server.gameId); const provider=serverCatalog().find(item=>item.id===game.id)!;
  if(game.installer==="manual") return NextResponse.json({supported:false,currentVersion:server.version,reason:"Custom servers use user-supplied files."});
  try {
    const versions=await catalogVersions(game.id); const latest=versions.find(item=>item.channel==="stable")?.id ?? versions[0]?.id ?? server.version;
    const rolling=latest==="latest";
    return NextResponse.json({supported:true,currentVersion:server.version,latestVersion:latest,updateAvailable:rolling || latest!==server.version,rolling,provider:provider.sourceName,checkedAt:new Date().toISOString()});
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:502}); }
}

export async function POST(_request: Request, context: {params: Promise<{id:string}>}) {
  const {id}=await context.params; const numeric=Number(id); const server=await load(numeric);
  if(!server) return NextResponse.json({error:"Not found"},{status:404});
  if(!["offline","crashed","error"].includes(server.status)) return NextResponse.json({error:"Stop the server before updating."},{status:409});
  const game=getGame(server.gameId);
  if(game.installer==="manual") return NextResponse.json({error:"Custom servers cannot be updated automatically."},{status:400});
  const versions=await catalogVersions(game.id); const latest=versions.find(item=>item.channel==="stable")?.id ?? versions[0]?.id ?? server.version;
  if(latest!=="latest" && latest!==server.version) await db.update(servers).set({version:latest,updatedAt:new Date()}).where(eq(servers.id,numeric));
  const result=await installFlow(numeric);
  return NextResponse.json({...result,version:latest},{status:result.ok?202:409});
}
