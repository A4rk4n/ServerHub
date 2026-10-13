import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers, type Server } from "@/db/schema";
import { readServerFile, writeServerFile } from "@/lib/filesys";
import {
  coerceGameSetting,
  GAME_SETTING_FIELDS,
  parseGameSettings,
  validateGameSettings,
} from "@/lib/game-settings";
import { logLine, propertiesText } from "@/lib/runtime";

export const dynamic = "force-dynamic";

const FILE = "server.properties";

async function loadServer(id: string): Promise<{ server?: Server; error?: NextResponse }> {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (server.gameId !== "minecraft" && server.gameId !== "minecraft-modded") {
    return { error: NextResponse.json({ error: "Gameplay settings apply to Minecraft Java servers" }, { status: 400 }) };
  }
  return { server };
}

async function readProperties(server: Server): Promise<string | null> {
  try {
    const file = await readServerFile(server, FILE);
    return file.editable ? file.content : null;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { server, error } = await loadServer(id);
  if (error || !server) return error ?? NextResponse.json({ error: "Not found" }, { status: 404 });
  const text = await readProperties(server);
  const raw = parseGameSettings(text);
  const fields = GAME_SETTING_FIELDS.map((field) => ({ ...field, value: coerceGameSetting(field, raw[field.key]) }));
  return NextResponse.json({ fields, exists: text !== null });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { server, error } = await loadServer(id);
  if (error || !server) return error ?? NextResponse.json({ error: "Not found" }, { status: 404 });

  let input: Record<string, unknown> = {};
  try {
    const body = (await req.json()) as { values?: Record<string, unknown> };
    input = body.values && typeof body.values === "object" ? body.values : {};
  } catch {
    // handled below
  }
  if (Object.keys(input).length === 0) return NextResponse.json({ error: "Expected `values`" }, { status: 400 });

  const { values, problems } = validateGameSettings(input);
  if (problems.length > 0) return NextResponse.json({ error: problems.join("; ") }, { status: 400 });

  const existing = (await readProperties(server)) ?? "";
  await writeServerFile(server, FILE, propertiesText(existing, values));
  const keys = Object.keys(values).sort();
  await logLine(server.id, "info", "Settings", `Gameplay settings updated: ${keys.join(", ")}. Changes apply on restart.`);
  return NextResponse.json({ ok: true, applied: keys });
}
