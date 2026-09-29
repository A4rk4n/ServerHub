import { NextResponse } from "next/server";
import { serverCatalog } from "@/lib/catalog";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ games: serverCatalog(), refreshedAt: new Date().toISOString() }); }
