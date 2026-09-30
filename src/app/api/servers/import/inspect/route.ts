import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame } from "@/lib/games";
import { detectGameFromFiles, listImportCandidates, validateImportPath } from "@/lib/server-import";
import { appDataDir, managedServerDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Fingerprint a directory before adopting it: which game (if any) lives
// there, and is the folder even eligible?
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{ directory: string }>;
    const directory = (body.directory ?? "").trim();
    const rows = await db.select({ workingDirectory: servers.workingDirectory, id: servers.id, managedDirectory: servers.managedDirectory }).from(servers);
    const claimed = rows.map((row) => (row.managedDirectory ? managedServerDir(row.id) : row.workingDirectory)).filter(Boolean);
    const invalid = validateImportPath(directory, { appData: appDataDir(), claimed });
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const resolved = path.resolve(directory);
    const stat = await fsp.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) return NextResponse.json({ error: "That path does not exist or is not a folder" }, { status: 400 });
    const files = await listImportCandidates(resolved);
    const detected = detectGameFromFiles(files);
    return NextResponse.json({
      directory: resolved,
      fileCount: files.length,
      detected,
      detectedName: detected ? getGame(detected).name : null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
