import { NextResponse } from "next/server";import { eq } from "drizzle-orm";import { db } from "@/db";import { serverTemplates } from "@/db/schema";
export async function DELETE(_r:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;await db.delete(serverTemplates).where(eq(serverTemplates.id,Number(id)));return NextResponse.json({ok:true})}
