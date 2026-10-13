import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { addons, servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { act, logLine } from "@/lib/runtime";
import {
  fetchCollectionChildren,
  fetchWorkshopDetails,
  parseWorkshopInput,
  WORKSHOP_SOURCE,
} from "@/lib/workshop";

export const dynamic = "force-dynamic";

const COLLECTION_CAP = 50;

// POST { input } — track every item of a public Workshop collection.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const workshop = getGame(server.gameId).workshop;
  if (!workshop) return NextResponse.json({ error: "This game has no Steam Workshop support" }, { status: 400 });

  let input = "";
  try {
    const body = (await req.json()) as { input?: unknown };
    input = typeof body.input === "string" ? body.input : "";
  } catch {
    // handled below
  }
  const collectionId = parseWorkshopInput(input);
  if (!collectionId) return NextResponse.json({ error: "Paste a Workshop collection URL or its numeric id" }, { status: 400 });

  let children: string[] | null;
  try {
    children = await fetchCollectionChildren(collectionId);
  } catch (err) {
    return NextResponse.json({ error: `Could not reach the Steam API: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
  if (children === null) return NextResponse.json({ error: "Steam has no public collection with this id" }, { status: 404 });
  if (children.length === 0) return NextResponse.json({ error: "This collection has no items" }, { status: 400 });

  const capped = children.slice(0, COLLECTION_CAP);
  const existing = await db.select().from(addons).where(and(eq(addons.serverId, server.id), eq(addons.source, WORKSHOP_SOURCE)));
  const tracked = new Set(existing.map((row) => row.projectId));

  let details;
  try {
    details = await fetchWorkshopDetails(capped.filter((child) => !tracked.has(child)));
  } catch (err) {
    return NextResponse.json({ error: `Could not reach the Steam API: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }

  const added: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  if (children.length > COLLECTION_CAP) {
    for (const child of children.slice(COLLECTION_CAP)) skipped.push({ id: child, reason: `beyond the ${COLLECTION_CAP}-item cap` });
  }
  for (const child of capped) {
    if (tracked.has(child)) {
      skipped.push({ id: child, reason: "already tracked" });
      continue;
    }
    const item = details.get(child);
    if (!item) {
      skipped.push({ id: child, reason: "unavailable (deleted or private)" });
      continue;
    }
    if (item.consumerAppId !== workshop.appId) {
      skipped.push({ id: child, reason: `belongs to a different game (app ${item.consumerAppId})` });
      continue;
    }
    await db.insert(addons).values({
      serverId: server.id,
      name: item.title,
      version: String(item.timeUpdated),
      author: "",
      source: WORKSHOP_SOURCE,
      summary: item.description,
      downloads: item.subscriptions,
      projectId: item.fileId,
      filePath: "",
    });
    added.push(item.title);
  }

  if (added.length > 0) {
    await logLine(server.id, "success", "Workshop", `Imported ${added.length} item${added.length === 1 ? "" : "s"} from collection ${collectionId}: ${added.join(", ")}.`);
    await act(server.id, "addon", `${added.length} Workshop item${added.length === 1 ? "" : "s"} imported from a collection on ${server.name}`);
  }
  return NextResponse.json({ added, skipped });
}
