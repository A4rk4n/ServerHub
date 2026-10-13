import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { getGame, hasGame } from "@/lib/games";
import { detectGameFromFiles, listImportCandidates, validateImportPath } from "@/lib/server-import";
import { EXPORT_MANIFEST_NAME, verifyExportManifest, type ExportManifest } from "@/lib/server-export";
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
    let detected = detectGameFromFiles(files);
    // Export-bundle twin: an extracted Server Hub bundle carries a manifest
    // with the original game, version, and launch settings — surface it so
    // the import form can prefill everything.
    let manifest: ExportManifest | null = null;
    try {
      const raw = JSON.parse(await fsp.readFile(path.join(resolved, EXPORT_MANIFEST_NAME), "utf8"));
      const verdict = verifyExportManifest(raw);
      if (verdict.ok) {
        manifest = verdict.manifest;
        if (!detected && hasGame(manifest.server.gameId)) detected = manifest.server.gameId;
      }
    } catch {
      /* no manifest — a plain directory import */
    }
    return NextResponse.json({
      directory: resolved,
      fileCount: files.length,
      detected,
      detectedName: detected ? getGame(detected).name : null,
      manifest,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
