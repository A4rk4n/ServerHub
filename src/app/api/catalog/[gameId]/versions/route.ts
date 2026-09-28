import { NextResponse } from "next/server";
import { catalogVersions } from "@/lib/catalog";
import { hasGame } from "@/lib/games";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await context.params;
  if (!hasGame(gameId)) return NextResponse.json({ error: "Unknown game" }, { status: 404 });
  try { return NextResponse.json({ gameId, versions: await catalogVersions(gameId), refreshedAt: new Date().toISOString() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 }); }
}
