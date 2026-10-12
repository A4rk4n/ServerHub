import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { addons, servers } from "@/db/schema";
import { act, logLine } from "@/lib/runtime";
import { safePath, serverDir } from "@/lib/storage";
import { cfModUrl, cfSearchUrl, pickLatestCurseforgeFile, versionFromFileName, type CurseforgeFileLike } from "@/lib/curseforge";
import { readCurseforgeKey } from "@/lib/curseforge-key";
import { cfFilesUrl } from "@/lib/curseforge";
import { curseforgeBase } from "@/lib/addon-sources";

export const dynamic = "force-dynamic";
const MODRINTH = "https://api.modrinth.com/v2";
const headers = { "User-Agent": "ServerHub/1.0 (local desktop server manager)" };

type Version = {
  id: string;
  project_id: string;
  version_number: string;
  dependencies: { version_id: string | null; project_id: string | null; dependency_type: string }[];
  files: { url: string; filename: string; primary: boolean; hashes: { sha512?: string } }[];
};

type Project = { id: string; title: string; description: string; team: string; downloads: number; slug: string };

async function getServer(id: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  return server;
}

async function modrinthJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers, next: { revalidate: 300 } });
  if (!response.ok) throw new Error(`Modrinth returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await getServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const installed = await db.select().from(addons).where(eq(addons.serverId, server.id)).orderBy(desc(addons.id));
  if (server.gameId !== "minecraft-modded" || server.loader !== "fabric") {
    return NextResponse.json({ installed, catalog: [], source: "No verified provider", supportsMods: false });
  }
  const params = new URL(req.url).searchParams;
  if (params.get("source") === "curseforge") {
    const apiKey = await readCurseforgeKey();
    if (!apiKey) {
      return NextResponse.json({ installed, catalog: [], source: "CurseForge — API key required", supportsMods: true, needsKey: true });
    }
    try {
      const query = params.get("q")?.slice(0, 100) ?? "";
      const response = await fetch(cfSearchUrl(curseforgeBase(), query, server.version), {
        headers: { ...headers, "x-api-key": apiKey },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`CurseForge returned HTTP ${response.status}${response.status === 403 ? " — check your API key" : ""}`);
      const payload = (await response.json()) as {
        data?: { id: number; name: string; summary?: string; downloadCount?: number; authors?: { name: string }[] }[];
      };
      const installedIds = new Set(installed.map((addon) => addon.projectId));
      const catalog = (payload.data ?? []).map((mod) => ({
        id: String(mod.id),
        name: mod.name,
        version: server.version,
        author: mod.authors?.[0]?.name ?? "CurseForge",
        downloads: mod.downloadCount ?? 0,
        summary: mod.summary ?? "",
        installed: installedIds.has(String(mod.id)),
      }));
      return NextResponse.json({ installed, catalog, source: "CurseForge (live)", supportsMods: true });
    } catch (error) {
      return NextResponse.json({ installed, catalog: [], source: "CurseForge unavailable", supportsMods: true, warning: error instanceof Error ? error.message : String(error) });
    }
  }
  try {
    const query = params.get("q")?.slice(0, 100) ?? "";
    const facets = JSON.stringify([["project_type:mod"], ["categories:fabric"], [`versions:${server.version}`]]);
    const search = await modrinthJson<{ hits: { project_id: string; title: string; description: string; author: string; downloads: number; latest_version: string }[] }>(
      `${MODRINTH}/search?limit=30&index=downloads&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}`
    );
    const installedIds = new Set(installed.map((addon) => addon.projectId));
    const catalog = search.hits.map((hit) => ({
      id: hit.project_id,
      name: hit.title,
      version: server.version,
      author: hit.author,
      downloads: hit.downloads,
      summary: hit.description,
      installed: installedIds.has(hit.project_id),
    }));
    return NextResponse.json({ installed, catalog, source: "Modrinth (live)", supportsMods: true });
  } catch (error) {
    return NextResponse.json({ installed, catalog: [], source: "Modrinth unavailable", supportsMods: true, warning: error instanceof Error ? error.message : String(error) });
  }
}

async function compatibleVersions(projectId: string, gameVersion: string): Promise<Version[]> {
  const loaders = encodeURIComponent(JSON.stringify(["fabric"]));
  const versions = encodeURIComponent(JSON.stringify([gameVersion]));
  return modrinthJson<Version[]>(`${MODRINTH}/project/${encodeURIComponent(projectId)}/version?loaders=${loaders}&game_versions=${versions}&featured=true`);
}

async function downloadMod(url: string, destination: string, expected?: { algo: "sha512" | "sha1"; hex: string; label: string }) {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Mod download failed: HTTP ${response.status}`);
  const temporary = `${destination}.download`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const output = fs.createWriteStream(temporary);
  Readable.fromWeb(response.body as never).pipe(output);
  await finished(output);
  if (expected) {
    const hash = crypto.createHash(expected.algo);
    const input = fs.createReadStream(temporary);
    input.on("data", (chunk) => hash.update(chunk));
    await finished(input);
    if (hash.digest("hex") !== expected.hex) {
      await fsp.rm(temporary, { force: true });
      throw new Error(`${expected.label} verification failed`);
    }
  }
  await fsp.rename(temporary, destination);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await getServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (server.gameId !== "minecraft-modded" || server.loader !== "fabric") return NextResponse.json({ error: "Live add-on installation is currently available for Fabric servers" }, { status: 400 });
  const { projectId, source } = (await req.json().catch(() => ({}))) as { projectId?: string; source?: string };
  if (!projectId || !/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) return NextResponse.json({ error: "A valid project ID is required" }, { status: 400 });

  const existing = await db.select().from(addons).where(eq(addons.serverId, server.id));
  if (existing.some((addon) => addon.projectId === projectId)) return NextResponse.json({ error: "Already installed" }, { status: 409 });

  // ---- CurseForge installs: SHA-1 verified, with required dependencies
  // resolved recursively (relationType 3) exactly like the Modrinth path —
  // a mod without its required libraries is a server that will not boot.
  if (source === "curseforge") {
    if (!/^\d+$/.test(projectId)) return NextResponse.json({ error: "A valid CurseForge mod ID is required" }, { status: 400 });
    const apiKey = await readCurseforgeKey();
    if (!apiKey) return NextResponse.json({ error: "Add your CurseForge API key first" }, { status: 400 });
    const cfHeaders = { ...headers, "x-api-key": apiKey };
    try {
      const installedIds = new Set(existing.map((addon) => addon.projectId));
      const installing = new Set<string>();
      const added: typeof existing = [];

      async function installCfMod(modId: string, dependency = false) {
        if (installedIds.has(modId) || installing.has(modId)) return;
        if (installing.size >= 30) throw new Error("Dependency chain exceeded 30 mods");
        installing.add(modId);
        const modResponse = await fetch(cfModUrl(curseforgeBase(), modId), { headers: cfHeaders, cache: "no-store" });
        if (!modResponse.ok) throw new Error(`CurseForge returned HTTP ${modResponse.status}`);
        const mod = ((await modResponse.json()) as { data: { id: number; name: string; summary?: string; downloadCount?: number; authors?: { name: string }[] } }).data;
        const filesResponse = await fetch(cfFilesUrl(curseforgeBase(), modId, server.version), { headers: cfHeaders, cache: "no-store" });
        if (!filesResponse.ok) throw new Error(`CurseForge returned HTTP ${filesResponse.status}`);
        const files = ((await filesResponse.json()) as { data?: CurseforgeFileLike[] }).data ?? [];
        const latest = pickLatestCurseforgeFile(files);
        if (!latest) throw new Error(`${mod.name} has no Fabric file compatible with Minecraft ${server.version}`);
        if (!latest.url) throw new Error(`The author of ${mod.name} has disabled third-party downloads — install it manually from CurseForge`);

        // Required libraries land first, so a failure mid-chain can never
        // leave the requested mod installed without something it needs.
        for (const requiredId of latest.requiredDependencies) {
          await installCfMod(String(requiredId), true);
        }

        const cleanName = path.basename(latest.filename);
        if (!/\.(jar|zip)$/i.test(cleanName)) throw new Error(`${mod.name} supplied an unsupported file type`);
        const relative = `mods/${cleanName}`;
        const destination = safePath(serverDir(server), relative);
        if (!destination) throw new Error("Unsafe mod filename rejected");
        await downloadMod(latest.url, destination, latest.sha1 ? { algo: "sha1", hex: latest.sha1, label: "CurseForge SHA-1" } : undefined);
        const [row] = await db.insert(addons).values({
          serverId: server.id,
          name: mod.name,
          version: versionFromFileName(cleanName),
          author: mod.authors?.[0]?.name ?? "CurseForge",
          source: dependency ? "CurseForge dependency" : "CurseForge",
          summary: mod.summary ?? "",
          downloads: mod.downloadCount ?? 0,
          projectId: modId,
          filePath: relative,
        }).returning();
        installedIds.add(modId);
        added.push(row);
        await logLine(server.id, "success", "Mods", `Installed ${mod.name} (${cleanName}) from CurseForge${dependency ? " (required dependency)" : ""}; SHA-1 verified.`);
      }

      await installCfMod(projectId);
      await act(server.id, "addon", `${added.map((addon) => addon.name).join(", ")} installed on ${server.name} (CurseForge)`);
      return NextResponse.json({ addons: added }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logLine(server.id, "error", "Mods", `Installation failed: ${message}`);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  try {
    const installedIds = new Set(existing.map((addon) => addon.projectId));
    const installing = new Set<string>();
    const added: typeof existing = [];

    async function installProject(currentProjectId: string, forcedVersion?: Version, dependency = false) {
      if (installedIds.has(currentProjectId) || installing.has(currentProjectId)) return;
      if (installing.size >= 30) throw new Error("Dependency chain exceeded 30 projects");
      installing.add(currentProjectId);
      const project = await modrinthJson<Project>(`${MODRINTH}/project/${encodeURIComponent(currentProjectId)}`);
      const version = forcedVersion ?? (await compatibleVersions(currentProjectId, server.version))[0];
      if (!version) throw new Error(`${project.title} has no Fabric version compatible with Minecraft ${server.version}`);

      for (const dependencyInfo of version.dependencies.filter((item) => item.dependency_type === "required")) {
        if (dependencyInfo.version_id) {
          const dependencyVersion = await modrinthJson<Version>(`${MODRINTH}/version/${encodeURIComponent(dependencyInfo.version_id)}`);
          await installProject(dependencyVersion.project_id, dependencyVersion, true);
        } else if (dependencyInfo.project_id) {
          await installProject(dependencyInfo.project_id, undefined, true);
        }
      }

      const artifact = version.files.find((file) => file.primary) ?? version.files[0];
      if (!artifact) throw new Error(`${project.title} version ${version.version_number} has no downloadable file`);
      const cleanName = path.basename(artifact.filename);
      if (!/\.(jar|zip)$/i.test(cleanName)) throw new Error(`${project.title} supplied an unsupported file type`);
      const relative = `mods/${cleanName}`;
      const destination = safePath(serverDir(server), relative);
      if (!destination) throw new Error("Unsafe mod filename rejected");
      await downloadMod(artifact.url, destination, artifact.hashes.sha512 ? { algo: "sha512", hex: artifact.hashes.sha512, label: "Modrinth SHA-512" } : undefined);
      const [row] = await db.insert(addons).values({
        serverId: server.id,
        name: project.title,
        version: version.version_number,
        author: "Modrinth",
        source: dependency ? "Modrinth dependency" : "Modrinth",
        summary: project.description,
        downloads: project.downloads,
        projectId: currentProjectId,
        filePath: relative,
      }).returning();
      installedIds.add(currentProjectId);
      added.push(row);
      await logLine(server.id, "success", "Mods", `Installed ${project.title} ${version.version_number}${dependency ? " (required dependency)" : ""}; SHA-512 verified.`);
    }

    await installProject(projectId);
    await act(server.id, "addon", `${added.map((addon) => addon.name).join(", ")} installed on ${server.name}`);
    return NextResponse.json({ addons: added }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logLine(server.id, "error", "Mods", `Installation failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
