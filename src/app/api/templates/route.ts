import { NextResponse } from "next/server";
import { desc,eq } from "drizzle-orm";
import { db } from "@/db";
import { servers,serverTemplates } from "@/db/schema";
import { templateConfigFromServer } from "@/lib/server-templates";
export const dynamic="force-dynamic";
export async function GET(){return NextResponse.json({templates:await db.select().from(serverTemplates).orderBy(desc(serverTemplates.id))})}
export async function POST(req:Request){const body=await req.json() as {serverId?:number;name?:string};const [server]=await db.select().from(servers).where(eq(servers.id,Number(body.serverId)));if(!server)return NextResponse.json({error:"Server not found"},{status:404});const name=(body.name??`${server.name} template`).trim().slice(0,60);if(!name)return NextResponse.json({error:"Template name is required"},{status:400});const config=templateConfigFromServer(server);const [template]=await db.insert(serverTemplates).values({name,gameId:server.gameId,config:JSON.stringify(config)}).returning();return NextResponse.json({template,excluded:["credentials","world identity","paths","ports","data"]},{status:201})}
