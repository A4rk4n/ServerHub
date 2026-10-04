import fs from "node:fs";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import * as tar from "tar";
import { db } from "@/db";
import { servers } from "@/db/schema";
import {
  EXPORT_FILE_LIMIT,
  EXPORT_FILE_PATTERN,
  EXPORT_MANIFEST_NAME,
  aggregateChecksum,
  buildExportManifest,
  exportFileName,
  shouldExcludeFromExport,
} from "@/lib/server-export";
import { act, logLine } from "@/lib/runtime";
import { appDataDir, serverDir } from "@/lib/storage";
import packageJson from "../../../../../../package.json";

export const dynamic = "force-dynamic";

async function loadServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server ?? null;
}

function exportsDir(serverId: number) {
  return path.join(appDataDir(), "exports", String(serverId));
}

async function walkFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (found.length >= EXPORT_FILE_LIMIT) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (found.length >= EXPORT_FILE_LIMIT) return;
      if (entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile()) {
        if (!shouldExcludeFromExport(rel)) found.push(rel);
      } else if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      }
    }
  };
  await walk(root, "");
  return found;
}

async function fileSha256(fullPath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(fullPath), hash);
  return hash.digest("hex");
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const root = serverDir(server);
  const manifestPath = path.join(root, EXPORT_MANIFEST_NAME);
  try {
    await fsp.mkdir(root, { recursive: true });
    const files = await walkFiles(root);
    if (files.length >= EXPORT_FILE_LIMIT) {
      return NextResponse.json({ error: `The server has too many files to export (limit ${EXPORT_FILE_LIMIT}).` }, { status: 400 });
    }
    let totalBytes = 0;
    const digests: Array<{ path: string; sha256: string }> = [];
    for (const rel of files) {
      const full = path.join(root, rel);
      const stat = await fsp.stat(full);
      totalBytes += stat.size;
      digests.push({ path: rel, sha256: await fileSha256(full) });
    }
    const manifest = buildExportManifest({
      server,
      appVersion: packageJson.version,
      files: { count: files.length, totalBytes, checksum: aggregateChecksum(digests) },
    });
    const outDir = exportsDir(server.id);
    await fsp.mkdir(outDir, { recursive: true });
    const fileName = exportFileName(server.name);
    const outFile = path.join(outDir, fileName);
    // The manifest sits at the archive root; it is written into the server
    // directory only for the duration of the tar call.
    await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    try {
      await tar.c({ cwd: root, file: outFile, gzip: true, portable: true }, [EXPORT_MANIFEST_NAME, ...files]);
    } finally {
      await fsp.rm(manifestPath, { force: true });
    }
    const sizeMb = Math.max(1, Math.round((await fsp.stat(outFile)).size / 1_048_576));
    await logLine(server.id, "system", "Export", `Export bundle ${fileName} created (${files.length} files, checksum ${manifest.files.checksum.value.slice(0, 12)}…).`);
    await act(server.id, "settings", `Export bundle created for ${server.name}`);
    return NextResponse.json({ ok: true, file: fileName, sizeMb, fileCount: files.length, totalBytes, checksum: manifest.files.checksum.value, manifest });
  } catch (error) {
    await fsp.rm(manifestPath, { force: true }).catch(() => {});
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await loadServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const dir = exportsDir(server.id);
  const requested = new URL(req.url).searchParams.get("file");
  if (!requested) {
    const names = (await fsp.readdir(dir).catch(() => [])).filter((name) => EXPORT_FILE_PATTERN.test(name)).sort().reverse();
    const bundles = [];
    for (const name of names) {
      const stat = await fsp.stat(path.join(dir, name)).catch(() => null);
      if (stat) bundles.push({ file: name, sizeMb: Math.max(1, Math.round(stat.size / 1_048_576)), createdAt: stat.mtime.toISOString() });
    }
    return NextResponse.json({ exports: bundles });
  }
  if (!EXPORT_FILE_PATTERN.test(requested)) return NextResponse.json({ error: "Invalid export file name" }, { status: 400 });
  const full = path.join(dir, requested);
  const stat = await fsp.stat(full).catch(() => null);
  if (!stat?.isFile()) return NextResponse.json({ error: "Export not found" }, { status: 404 });
  const stream = Readable.toWeb(fs.createReadStream(full)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${requested}"`,
    },
  });
}
