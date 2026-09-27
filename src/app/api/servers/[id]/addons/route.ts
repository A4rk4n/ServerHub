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
  try {
    const query = new URL(req.url).searchParams.get("q")?.slice(0, 100) ?? "";
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

async function downloadMod(url: string, destination: string, expectedSha512?: string) {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Mod download failed: HTTP ${response.status}`);
  const temporary = `${destination}.download`;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const output = fs.createWriteStream(temporary);
  Readable.fromWeb(response.body as never).pipe(output);
  await finished(output);
  if (expectedSha512) {
    const hash = crypto.createHash("sha512");
    const input = fs.createReadStream(temporary);
    input.on("data", (chunk) => hash.update(chunk));
    await finished(input);
    if (hash.digest("hex") !== expectedSha512) {
      await fsp.rm(temporary, { force: true });
      throw new Error("Modrinth SHA-512 verification failed");
    }
  }
  await fsp.rename(temporary, destination);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const server = await getServer(id);
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (server.gameId !== "minecraft-modded" || server.loader !== "fabric") return NextResponse.json({ error: "Live add-on installation is currently available for Fabric servers" }, { status: 400 });
  const { projectId } = (await req.json()) as { projectId?: string };
  if (!projectId || !/^[A-Za-z0-9_-]{3,64}$/.test(projectId)) return NextResponse.json({ error: "A valid Modrinth project ID is required" }, { status: 400 });

  const existing = await db.select().from(addons).where(eq(addons.serverId, server.id));
  if (existing.some((addon) => addon.projectId === projectId)) return NextResponse.json({ error: "Already installed" }, { status: 409 });

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
      await downloadMod(artifact.url, destination, artifact.hashes.sha512);
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
