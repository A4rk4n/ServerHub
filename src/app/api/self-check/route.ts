import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, dbPath, sqliteClient } from "@/db";
import { addons, backups, consoleLogs, servers } from "@/db/schema";
import {
  evalAddonFiles,
  evalBackupArchives,
  evalConsoleBacklog,
  evalDatabase,
  evalDiskFree,
  evalSidecars,
  summarizeSelfCheck,
  type SelfCheckItem,
} from "@/lib/self-check";
import { appDataDir, backupsDir, safePath, serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

async function databaseFacts(): Promise<{ sizeBytes: number; integrity: string | null }> {
  const stat = await fsp.stat(dbPath).catch(() => null);
  let integrity: string | null = null;
  try {
    // node:sqlite's DatabaseSync has no pragma() helper — go through a
    // prepared statement; the result row is { quick_check: "ok" }.
    const client = sqliteClient() as unknown as { prepare: (statement: string) => { get: () => unknown } };
    const row = client.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
    const value = row ? Object.values(row)[0] : null;
    integrity = typeof value === "string" ? value : null;
  } catch {
    integrity = null;
  }
  return { sizeBytes: stat?.size ?? 0, integrity };
}

async function sidecarFacts(): Promise<{ bad: string[]; total: number }> {
  const entries = await fsp.readdir(appDataDir()).catch(() => [] as string[]);
  const bad: string[] = [];
  let total = 0;
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    total += 1;
    try {
      JSON.parse(await fsp.readFile(path.join(appDataDir(), name), "utf8"));
    } catch {
      bad.push(name);
    }
  }
  return { bad, total };
}

async function backupFacts(): Promise<{ missingNames: string[]; orphanedCount: number; orphanedBytes: number }> {
  const rows = await db.select().from(backups).where(eq(backups.status, "complete"));
  const known = new Set<string>();
  const missingNames: string[] = [];
  for (const row of rows) {
    if (!row.archivePath) continue;
    known.add(path.resolve(row.archivePath));
    const stat = await fsp.stat(row.archivePath).catch(() => null);
    if (!stat) missingNames.push(row.name);
  }
  // Anything .tar.gz under the backups tree that no row points at.
  let orphanedCount = 0;
  let orphanedBytes = 0;
  const root = path.dirname(backupsDir(1));
  const serverDirs = await fsp.readdir(root).catch(() => [] as string[]);
  for (const dir of serverDirs) {
    const full = path.join(root, dir);
    const files = await fsp.readdir(full).catch(() => [] as string[]);
    for (const file of files) {
      if (!file.endsWith(".tar.gz")) continue;
      const archive = path.resolve(full, file);
      if (known.has(archive)) continue;
      orphanedCount += 1;
      orphanedBytes += (await fsp.stat(archive).catch(() => null))?.size ?? 0;
    }
  }
  return { missingNames, orphanedCount, orphanedBytes };
}

async function addonFacts(): Promise<string[]> {
  const fleet = await db.select().from(servers);
  const missing: string[] = [];
  for (const server of fleet) {
    const rows = await db.select().from(addons).where(eq(addons.serverId, server.id));
    for (const addon of rows) {
      if (!addon.filePath) continue;
      const file = safePath(serverDir(server), addon.filePath);
      if (!file) continue;
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat) missing.push(`${addon.name} (${server.name})`);
    }
  }
  return missing;
}

export async function GET() {
  const [database, sidecars, backupState, missingAddons] = await Promise.all([
    databaseFacts(),
    sidecarFacts(),
    backupFacts(),
    addonFacts(),
  ]);
  const [{ n: consoleRows }] = await db.select({ n: sql<number>`count(*)` }).from(consoleLogs);
  const stat = await fsp.statfs(appDataDir()).catch(() => null);
  const freeMb = stat ? Math.floor((stat.bavail * stat.bsize) / 1024 / 1024) : null;

  const items: SelfCheckItem[] = [
    evalDatabase(database.sizeBytes, database.integrity),
    evalConsoleBacklog(Number(consoleRows)),
    evalSidecars(sidecars.bad, sidecars.total),
    evalBackupArchives(backupState.missingNames, backupState.orphanedCount, backupState.orphanedBytes),
    evalAddonFiles(missingAddons),
    evalDiskFree(freeMb),
  ];
  return NextResponse.json({ items, summary: summarizeSelfCheck(items), checkedAt: new Date().toISOString() });
}
