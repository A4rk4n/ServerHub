import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { addons, servers } from "@/db/schema";
import { MAX_MOD_UPLOAD_BYTES, modNameFromFileName, validateModUploadName } from "@/lib/addon-upload";
import { act, logLine } from "@/lib/runtime";
import { safePath, serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (server.gameId !== "minecraft-modded" || server.loader !== "fabric") {
    return NextResponse.json({ error: "Mod upload is currently available for Fabric servers" }, { status: 400 });
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const entry = form.get("file");
    file = entry instanceof File ? entry : null;
  } catch {
    return NextResponse.json({ error: "Expected a multipart form with a `file` field" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Expected a multipart form with a `file` field" }, { status: 400 });

  const problem = validateModUploadName(file.name);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "The uploaded file is empty" }, { status: 400 });
  if (file.size > MAX_MOD_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Mod uploads are capped at ${Math.round(MAX_MOD_UPLOAD_BYTES / 1024 / 1024)} MB` }, { status: 413 });
  }

  const relative = `mods/${file.name}`;
  const destination = safePath(serverDir(server), relative);
  if (!destination) return NextResponse.json({ error: "Unsafe mod filename rejected" }, { status: 400 });

  const existing = await db.select().from(addons).where(eq(addons.serverId, server.id));
  if (existing.some((addon) => addon.filePath === relative || addon.filePath === `${relative}.disabled`)) {
    return NextResponse.json({ error: "A mod with this file name is already installed" }, { status: 409 });
  }
  const already = await fsp.stat(destination).catch(() => null);
  if (already) return NextResponse.json({ error: "A file with this name already exists in the mods folder" }, { status: 409 });

  // Buffer → temp → rename: the mods folder never sees a partial file.
  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
  const temporary = `${destination}.upload`;
  await fsp.mkdir(serverDir(server) + "/mods", { recursive: true });
  await fsp.writeFile(temporary, bytes);
  await fsp.rename(temporary, destination);

  const [row] = await db.insert(addons).values({
    serverId: server.id,
    name: modNameFromFileName(file.name),
    version: modNameFromFileName(file.name),
    author: "you",
    source: "Manual upload",
    summary: "Uploaded through the mod manager.",
    downloads: 0,
    projectId: "",
    filePath: relative,
  }).returning();
  await logLine(server.id, "success", "Mods", `Uploaded ${file.name} (${(file.size / 1024).toFixed(0)} KB, SHA-256 ${checksum.slice(0, 12)}…).`);
  await act(server.id, "addon", `${row.name} uploaded to ${server.name}`);
  return NextResponse.json({ addon: row }, { status: 201 });
}
