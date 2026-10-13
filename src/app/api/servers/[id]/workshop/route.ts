import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { addons, servers, type Server } from "@/db/schema";
import { getGame } from "@/lib/games";
import { act, logLine } from "@/lib/runtime";
import {
  activationFor,
  fetchWorkshopDetails,
  parseWorkshopInput,
  steamcmdDownloadCommand,
  WORKSHOP_SOURCE,
} from "@/lib/workshop";

export const dynamic = "force-dynamic";

async function loadWorkshopServer(id: string): Promise<{ server?: Server; workshop?: { appId: number; contentLabel: string }; error?: NextResponse }> {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const workshop = getGame(server.gameId).workshop;
  if (!workshop) return { error: NextResponse.json({ error: "This game has no Steam Workshop support" }, { status: 400 }) };
  return { server, workshop };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { server, workshop, error } = await loadWorkshopServer(id);
  if (error || !server || !workshop) return error ?? NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db.select().from(addons).where(and(eq(addons.serverId, server.id), eq(addons.source, WORKSHOP_SOURCE)));
  const enabledIds = rows.filter((row) => row.enabled).map((row) => row.projectId);
  return NextResponse.json({
    items: rows.map((row) => ({ ...row, downloadCommand: steamcmdDownloadCommand(workshop.appId, row.projectId) })),
    activation: activationFor(server.gameId, enabledIds),
    workshop,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { server, workshop, error } = await loadWorkshopServer(id);
  if (error || !server || !workshop) return error ?? NextResponse.json({ error: "Not found" }, { status: 404 });

  let input = "";
  try {
    const body = (await req.json()) as { input?: unknown };
    input = typeof body.input === "string" ? body.input : "";
  } catch {
    // handled below
  }
  const fileId = parseWorkshopInput(input);
  if (!fileId) return NextResponse.json({ error: "Paste a Workshop item URL or its numeric id" }, { status: 400 });

  const existing = await db.select().from(addons).where(and(eq(addons.serverId, server.id), eq(addons.source, WORKSHOP_SOURCE)));
  if (existing.some((row) => row.projectId === fileId)) {
    return NextResponse.json({ error: "This Workshop item is already tracked" }, { status: 409 });
  }

  let details;
  try {
    details = (await fetchWorkshopDetails([fileId])).get(fileId);
  } catch (err) {
    return NextResponse.json({ error: `Could not reach the Steam API: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
  if (!details) return NextResponse.json({ error: "Steam has no public Workshop item with this id (deleted, private, or wrong id)" }, { status: 404 });
  if (details.consumerAppId !== workshop.appId) {
    return NextResponse.json({ error: `This item belongs to a different game (app ${details.consumerAppId}, expected ${workshop.appId})` }, { status: 400 });
  }

  const [row] = await db.insert(addons).values({
    serverId: server.id,
    name: details.title,
    version: String(details.timeUpdated),
    author: "",
    source: WORKSHOP_SOURCE,
    summary: details.description,
    downloads: details.subscriptions,
    projectId: details.fileId,
    filePath: "",
  }).returning();
  await logLine(server.id, "success", "Workshop", `Tracking ${details.title} (item ${details.fileId}).`);
  await act(server.id, "addon", `${details.title} tracked from the Steam Workshop on ${server.name}`);
  return NextResponse.json({ item: { ...row, downloadCommand: steamcmdDownloadCommand(workshop.appId, row.projectId) } }, { status: 201 });
}
