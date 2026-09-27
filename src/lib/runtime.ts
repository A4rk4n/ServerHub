import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { activity, backups, consoleLogs, players, servers, tasks } from "@/db/schema";
import type { Backup, Server } from "@/db/schema";
import { getGame } from "./games";
import { appDataDir, backupsDir, ensureDataDirs, safeFileName, serverDir, toolsDir } from "./storage";

export type Metric = { t: number; cpu: number; ram: number; players: number; tps: number | null };

type ProcSample = { at: number; cpuTime: number };
type RuntimeEntry = {
  child: ChildProcessWithoutNullStreams;
  server: Server;
  metrics: Metric[];
  sample?: ProcSample;
  monitor: NodeJS.Timeout;
  stopping: boolean;
  restarting: boolean;
  lineCount: number;
};

type RuntimeState = {
  processes: Map<number, RuntimeEntry>;
  installs: Set<number>;
  initialized?: Promise<void>;
  scheduler?: NodeJS.Timeout;
  sweeping: boolean;
  closing: boolean;
};

const globalRuntime = globalThis as typeof globalThis & { __serverHubRuntime?: RuntimeState };
const state: RuntimeState =
  globalRuntime.__serverHubRuntime ??
  ({ processes: new Map(), installs: new Set(), sweeping: false, closing: false } satisfies RuntimeState);
globalRuntime.__serverHubRuntime = state;

export async function logLine(serverId: number, level: string, source: string, message: string) {
  const clean = message.replace(/\0/g, "").slice(0, 16_000);
  await db.insert(consoleLogs).values({ serverId, level, source, message: clean });
}

export async function act(serverId: number | null, kind: string, message: string) {
  await db.insert(activity).values({ serverId, kind, message: message.slice(0, 1000) });
}

export async function setStatus(id: number, status: string) {
  await db.update(servers).set({ status, updatedAt: new Date() }).where(eq(servers.id, id));
}

async function initializeRuntime() {
  ensureDataDirs();
  const rows = await db.select().from(servers);
  for (const server of rows) {
    if (["online", "starting", "stopping"].includes(server.status)) {
      await setStatus(server.id, "crashed");
      await logLine(server.id, "warn", "Runtime", "The Server Hub runtime restarted; the previous process is no longer attached.");
    } else if (server.status === "installing") {
      await setStatus(server.id, "error");
      await logLine(server.id, "warn", "Installer", "Installation was interrupted. Use Retry installation to continue.");
    }
    await db.update(players).set({ isOnline: false }).where(eq(players.serverId, server.id));
  }

  if (!state.scheduler) {
    state.scheduler = setInterval(() => void sweepTasks().catch(() => {}), 15_000);
    state.scheduler.unref?.();
  }

  const shutdown = () => {
    if (state.closing) return;
    state.closing = true;
    for (const entry of state.processes.values()) {
      entry.stopping = true;
      try { entry.child.stdin.write(`${stopCommand(entry.server)}\n`); } catch { /* already closed */ }
    }
    const timer = setTimeout(() => {
      for (const entry of state.processes.values()) killProcessTree(entry.child.pid, true);
      process.exit(0);
    }, 2_000);
    timer.unref?.();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export async function ensureRuntimeInitialized() {
  if (!state.initialized) {
    state.initialized = initializeRuntime().catch((error) => {
      state.initialized = undefined;
      throw error;
    });
  }
  await state.initialized;
}

export async function attachIfNeeded(_server: Server) {
  await ensureRuntimeInitialized();
}

function inferLevel(line: string, stderr = false): string {
  const upper = line.toUpperCase();
  if (stderr || /\b(ERROR|FATAL|EXCEPTION|SEVERE)\b/.test(upper)) return "error";
  if (/\bWARN(?:ING)?\b/.test(upper)) return "warn";
  if (/\b(DONE|READY|STARTED|SUCCESS)\b/.test(upper)) return "success";
  return "info";
}

function pipeLines(entry: RuntimeEntry, stream: NodeJS.ReadableStream, stderr = false) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) consumeProcessLine(entry, line, stderr);
  });
  stream.on("end", () => {
    if (pending) consumeProcessLine(entry, pending, stderr);
  });
}

function consumeProcessLine(entry: RuntimeEntry, raw: string, stderr: boolean) {
  const line = raw.replace(/\r$/, "");
  if (!line.trim()) return;
  entry.lineCount++;
  void logLine(entry.server.id, inferLevel(line, stderr), stderr ? "stderr" : "Server", line).catch(() => {});
  void parsePlayerLine(entry.server, line).catch(() => {});
  if (entry.lineCount % 500 === 0) void pruneLogs(entry.server.id).catch(() => {});
}

async function pruneLogs(serverId: number) {
  const rows = await db.select({ id: consoleLogs.id }).from(consoleLogs).where(eq(consoleLogs.serverId, serverId)).orderBy(asc(consoleLogs.id));
  const remove = rows.length - 10_000;
  if (remove > 0) {
    for (const row of rows.slice(0, remove)) await db.delete(consoleLogs).where(eq(consoleLogs.id, row.id));
  }
}

async function parsePlayerLine(server: Server, line: string) {
  const joined =
    line.match(/(?:]:\s*)?([A-Za-z0-9_]{1,32}) joined the game\b/i) ??
    line.match(/Player connected:\s*([A-Za-z0-9_ ]{1,32})/i);
  const left =
    line.match(/(?:]:\s*)?([A-Za-z0-9_]{1,32}) left the game\b/i) ??
    line.match(/Player disconnected:\s*([A-Za-z0-9_ ]{1,32})/i);
  if (joined) await upsertPlayer(server.id, joined[1].trim(), true);
  if (left) await upsertPlayer(server.id, left[1].trim(), false);

  const list = line.match(/There are \d+ of a max of \d+ players online:\s*(.*)$/i);
  if (list) {
    const names = list[1].split(",").map((name) => name.trim()).filter(Boolean);
    await db.update(players).set({ isOnline: false }).where(eq(players.serverId, server.id));
    for (const name of names) await upsertPlayer(server.id, name, true);
  }
}

async function upsertPlayer(serverId: number, name: string, online: boolean) {
  const [existing] = await db.select().from(players).where(and(eq(players.serverId, serverId), eq(players.name, name)));
  if (existing) {
    await db.update(players).set({ isOnline: online, lastSeen: new Date() }).where(eq(players.id, existing.id));
  } else {
    await db.insert(players).values({
      serverId,
      name,
      externalId: `observed:${name.toLowerCase()}`,
      isOnline: online,
      ping: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

async function downloadFile(url: string, destination: string, serverId: number, label: string) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await logLine(serverId, "system", "Installer", `Downloading ${label}…`);
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "ServerHub/1.0 (+local desktop server manager)" },
  });
  if (!response.ok || !response.body) throw new Error(`${label} download failed: HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length") || 0);
  const temp = `${destination}.download`;
  const output = fs.createWriteStream(temp);
  let received = 0;
  let lastPercent = -10;
  const source = Readable.fromWeb(response.body as never);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (total) {
      const percent = Math.floor((received / total) * 100);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        void logLine(serverId, "system", "Installer", `${label}: ${percent}% (${(received / 1024 / 1024).toFixed(1)} MB)`).catch(() => {});
      }
    }
  });
  source.pipe(output);
  await finished(output);
  await fsp.rm(destination, { force: true });
  await fsp.rename(temp, destination);
  await logLine(serverId, "success", "Installer", `${label} downloaded (${(received / 1024 / 1024).toFixed(1)} MB).`);
}

async function sha1(file: string): Promise<string> {
  const hash = crypto.createHash("sha1");
  const stream = fs.createReadStream(file);
  stream.on("data", (chunk) => hash.update(chunk));
  await finished(stream);
  return hash.digest("hex");
}

async function installMojang(server: Server, root: string) {
  const manifestResponse = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  if (!manifestResponse.ok) throw new Error(`Mojang version manifest failed: HTTP ${manifestResponse.status}`);
  const manifest = (await manifestResponse.json()) as { versions: { id: string; url: string }[] };
  const selected = manifest.versions.find((version) => version.id === server.version);
  if (!selected) throw new Error(`Minecraft ${server.version} is not present in Mojang's official manifest.`);
  const detailResponse = await fetch(selected.url);
  if (!detailResponse.ok) throw new Error(`Minecraft ${server.version} metadata failed: HTTP ${detailResponse.status}`);
  const detail = (await detailResponse.json()) as { downloads?: { server?: { url: string; sha1: string } } };
  const artifact = detail.downloads?.server;
  if (!artifact) throw new Error(`Minecraft ${server.version} has no dedicated-server artifact.`);
  const jar = path.join(root, "server.jar");
  await downloadFile(artifact.url, jar, server.id, `Minecraft ${server.version} server`);
  if ((await sha1(jar)) !== artifact.sha1) throw new Error("Minecraft server checksum did not match Mojang metadata.");
  await logLine(server.id, "success", "Installer", "Mojang SHA-1 checksum verified.");
}

async function installFabric(server: Server, root: string) {
  const response = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(server.version)}`);
  if (!response.ok) throw new Error(`Fabric does not publish a loader for Minecraft ${server.version} (HTTP ${response.status}).`);
  const versions = (await response.json()) as { loader: { version: string; stable: boolean }; installer: { version: string; stable: boolean } }[];
  const choice = versions.find((item) => item.loader.stable && item.installer.stable) ?? versions[0];
  if (!choice) throw new Error(`No Fabric loader is available for Minecraft ${server.version}.`);
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(server.version)}/${encodeURIComponent(choice.loader.version)}/${encodeURIComponent(choice.installer.version)}/server/jar`;
  await downloadFile(url, path.join(root, "server.jar"), server.id, `Fabric loader ${choice.loader.version}`);
  await logLine(server.id, "success", "Installer", `Fabric ${choice.loader.version} installed for Minecraft ${server.version}.`);
}

async function installBedrock(server: Server, root: string) {
  if (!["win32", "linux"].includes(process.platform)) throw new Error("The official Bedrock server is only published for Windows and Linux.");
  const page = await fetch("https://www.minecraft.net/en-us/download/server/bedrock", {
    headers: { "User-Agent": "Mozilla/5.0 ServerHub/1.0" },
  });
  if (!page.ok) throw new Error(`Minecraft Bedrock download page failed: HTTP ${page.status}`);
  const html = (await page.text()).replaceAll("&amp;", "&").replaceAll("\\u0026", "&");
  const platform = process.platform === "win32" ? "win" : "linux";
  const matches = [...html.matchAll(/https:\/\/[^"'<>\\\s]+bedrock-server-[^"'<>\\\s]+\.zip/gi)].map((match) => match[0]);
  const url = matches.find((candidate) => candidate.toLowerCase().includes(`bin-${platform}`)) ?? matches.find((candidate) => candidate.toLowerCase().includes(platform));
  if (!url) throw new Error("Could not locate the official Bedrock archive. Microsoft may have changed its download page.");
  const archive = path.join(appDataDir(), "downloads", `bedrock-${server.id}.zip`);
  await downloadFile(url, archive, server.id, "Minecraft Bedrock server");
  await extractZipSafe(archive, root);
  await fsp.rm(archive, { force: true });
  if (process.platform !== "win32") await fsp.chmod(path.join(root, "bedrock_server"), 0o755).catch(() => {});
}

async function extractZipSafe(archive: string, destination: string) {
  const opened = new AdmZip(archive);
  const root = path.resolve(destination);
  await fsp.mkdir(root, { recursive: true });
  for (const entry of opened.getEntries()) {
    const normalized = entry.entryName.replaceAll("\\", "/");
    const target = path.resolve(root, normalized);
    const unixMode = (entry.attr >>> 16) & 0xffff;
    const isSymlink = (unixMode & 0o170000) === 0o120000;
    if (!normalized || isSymlink || normalized.startsWith("/") || normalized.split("/").includes("..") || (target !== root && !target.startsWith(`${root}${path.sep}`))) {
      throw new Error(`Unsafe ZIP entry rejected: ${entry.entryName}`);
    }
    if (entry.isDirectory) await fsp.mkdir(target, { recursive: true });
    else {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, entry.getData());
    }
  }
}

async function extractTarGz(archive: string, destination: string) {
  await fsp.mkdir(destination, { recursive: true });
  await tar.x({ file: archive, cwd: destination, gzip: true, strict: true, preservePaths: false });
}

async function ensureSteamCmd(serverId: number): Promise<string> {
  const root = path.join(toolsDir(), "steamcmd");
  const executable = process.platform === "win32" ? path.join(root, "steamcmd.exe") : path.join(root, "steamcmd.sh");
  if (fs.existsSync(executable)) return executable;
  if (process.platform === "darwin") throw new Error("SteamCMD no longer provides a native macOS dedicated-server runtime. Use a custom command, VM, or Linux host.");
  await fsp.mkdir(root, { recursive: true });
  const ext = process.platform === "win32" ? "zip" : "tar.gz";
  const archive = path.join(appDataDir(), "downloads", `steamcmd.${ext}`);
  const url = process.platform === "win32"
    ? "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip"
    : "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz";
  await downloadFile(url, archive, serverId, "SteamCMD");
  if (process.platform === "win32") await extractZipSafe(archive, root);
  else await extractTarGz(archive, root);
  await fsp.rm(archive, { force: true });
  if (process.platform !== "win32") await fsp.chmod(executable, 0o755);
  return executable;
}

async function runLogged(serverId: number, executable: string, args: string[], cwd: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const read = (stream: NodeJS.ReadableStream, isError: boolean) => {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          tail = `${tail}\n${line}`.slice(-4000);
          void logLine(serverId, inferLevel(line, isError), "Installer", line).catch(() => {});
        }
      });
    };
    read(child.stdout, false);
    read(child.stderr, true);
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code}.${tail ? ` Last output:${tail}` : ""}`)));
  });
}

async function installSteam(server: Server, root: string) {
  const game = getGame(server.gameId);
  if (!game.steamAppId) throw new Error(`${game.name} has no verified SteamCMD application ID.`);
  const steamcmd = await ensureSteamCmd(server.id);
  await logLine(server.id, "system", "Installer", `Installing ${game.name} from Steam app ${game.steamAppId}. Large games can take a long time.`);
  await runLogged(server.id, steamcmd, [
    "+force_install_dir", root,
    "+login", "anonymous",
    "+app_update", String(game.steamAppId), "validate",
    "+quit",
  ], path.dirname(steamcmd));
}

export async function installFlow(id: number) {
  await ensureRuntimeInitialized();
  if (state.installs.has(id)) return { ok: false, reason: "Installation is already running" };
  const [server] = await db.select().from(servers).where(eq(servers.id, id));
  if (!server) return { ok: false, reason: "Server not found" };
  if (state.processes.has(id)) return { ok: false, reason: "Stop the server before reinstalling" };
  state.installs.add(id);
  await setStatus(id, "installing");

  void (async () => {
    const root = serverDir(server);
    try {
      await fsp.mkdir(root, { recursive: true });
      const game = getGame(server.gameId);
      await logLine(id, "system", "Installer", `Installing ${game.name} into ${root}`);
      if (game.installer === "mojang") await installMojang(server, root);
      else if (game.installer === "fabric") await installFabric(server, root);
      else if (game.installer === "bedrock") await installBedrock(server, root);
      else if (game.installer === "steamcmd") await installSteam(server, root);
      else {
        if (!server.launchCommand.trim()) throw new Error("A launch command is required for a manual server.");
        await logLine(id, "system", "Installer", "Manual server registered; Server Hub will not modify or download its program files.");
      }
      await writeServerConfig(server);
      await setStatus(id, "offline");
      await logLine(id, "success", "Installer", `Installation complete. ${server.name} is ready to start.`);
      await act(id, "server", `${server.name} installed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStatus(id, "error");
      await logLine(id, "error", "Installer", message);
      await act(id, "server", `${server.name} installation failed: ${message}`);
    } finally {
      state.installs.delete(id);
    }
  })();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Configuration and launch recipes
// ---------------------------------------------------------------------------

function propertiesText(existing: string, values: Record<string, string | number | boolean>): string {
  const remaining = new Map(Object.entries(values).map(([key, value]) => [key, String(value).replace(/[\r\n]/g, " ")]));
  const lines = existing ? existing.split(/\r?\n/) : [];
  const output = lines.map((line) => {
    const match = line.match(/^\s*([^#!=\s]+)\s*=/);
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1])!;
    remaining.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  for (const [key, value] of remaining) output.push(`${key}=${value}`);
  return `${output.filter((line, index) => line || index < output.length - 1).join("\n")}\n`;
}

async function mergeProperties(file: string, values: Record<string, string | number | boolean>) {
  const existing = await fsp.readFile(file, "utf8").catch(() => "");
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, propertiesText(existing, values), "utf8");
}

export async function writeServerConfig(server: Server) {
  const root = serverDir(server);
  await fsp.mkdir(root, { recursive: true });
  if (server.gameId === "minecraft" || server.gameId === "minecraft-modded") {
    if (!server.eulaAccepted) throw new Error("The Minecraft EULA must be accepted before installation.");
    await fsp.writeFile(path.join(root, "eula.txt"), "# Accepted explicitly during Server Hub setup\neula=true\n", "utf8");
    await mergeProperties(path.join(root, "server.properties"), {
      motd: server.motd,
      "server-port": server.port,
      "max-players": server.maxPlayers,
      difficulty: server.difficulty,
      pvp: server.pvp,
      "level-name": server.worldName,
      "level-seed": server.seed,
      "online-mode": true,
      "view-distance": 10,
      "simulation-distance": 8,
    });
  } else if (server.gameId === "minecraft-bedrock") {
    await mergeProperties(path.join(root, "server.properties"), {
      "server-name": server.name,
      "server-port": server.port,
      "server-portv6": server.port + 1,
      "max-players": server.maxPlayers,
      "level-name": server.worldName,
      "level-seed": server.seed,
      difficulty: server.difficulty,
      "allow-cheats": false,
      "online-mode": true,
    });
  } else if (server.gameId === "terraria") {
    const config = [
      `world=${path.join(root, "Worlds", `${safeFileName(server.worldName, "world")}.wld`)}`,
      "autocreate=3",
      `worldname=${server.worldName}`,
      `difficulty=${Math.max(0, ["peaceful", "easy", "normal", "hard"].indexOf(server.difficulty))}`,
      `maxplayers=${server.maxPlayers}`,
      `port=${server.port}`,
      `motd=${server.motd.replace(/[\r\n]/g, " ")}`,
      "secure=1",
      "",
    ].join("\n");
    await fsp.writeFile(path.join(root, "serverconfig.txt"), config, "utf8");
  }
}

function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
    } else if (char === "\\" && quote !== "'") escaping = true;
    else if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === "'" || char === '"') quote = char;
    else if (/\s/.test(char)) {
      if (current) { args.push(current); current = ""; }
    } else current += char;
  }
  if (escaping) current += "\\";
  if (current) args.push(current);
  return args;
}

async function findExecutable(root: string, candidates: string[]): Promise<string | null> {
  const wanted = new Set(candidates.map((item) => item.toLowerCase().replaceAll("\\", "/")));
  const queue = [root];
  let seen = 0;
  while (queue.length && seen < 20_000) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      seen++;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll("\\", "/").toLowerCase();
      if (entry.isFile() && (wanted.has(rel) || wanted.has(entry.name.toLowerCase()))) return full;
      if (entry.isDirectory() && ![".git", "logs", "world", "worlds", "server"].includes(entry.name.toLowerCase())) queue.push(full);
    }
  }
  return null;
}

function javaMajorForMinecraft(version: string): number {
  const parts = version.split(".").map(Number);
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  if (minor <= 16) return 8;
  if (minor < 20 || (minor === 20 && patch <= 4)) return 17;
  return 21;
}

async function ensureJava(serverId: number, major: number): Promise<string> {
  const executableName = process.platform === "win32" ? "java.exe" : "java";
  const javaRoot = path.join(toolsDir(), `java-${major}`);
  const existing = await findExecutable(javaRoot, [executableName, `bin/${executableName}`]);
  if (existing) return existing;

  // Download a private JRE: users do not need Java or administrator rights.
  const platformMap: Record<string, string> = { win32: "windows", linux: "linux", darwin: "mac" };
  const archMap: Record<string, string> = { x64: "x64", arm64: "aarch64" };
  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];
  if (!platform || !arch) throw new Error(`No automatic Java runtime is available for ${process.platform}/${process.arch}. Install Java ${major} and try again.`);
  const ext = process.platform === "win32" ? "zip" : "tar.gz";
  const archive = path.join(appDataDir(), "downloads", `temurin-jre${major}.${ext}`);
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${platform}/${arch}/jre/hotspot/normal/eclipse`;
  await downloadFile(url, archive, serverId, `Eclipse Temurin Java ${major} runtime`);
  await fsp.rm(javaRoot, { recursive: true, force: true });
  await fsp.mkdir(javaRoot, { recursive: true });
  if (ext === "zip") await extractZipSafe(archive, javaRoot);
  else await extractTarGz(archive, javaRoot);
  await fsp.rm(archive, { force: true });
  const java = await findExecutable(javaRoot, [executableName, `bin/${executableName}`]);
  if (!java) throw new Error("Java runtime archive did not contain a java executable.");
  if (process.platform !== "win32") await fsp.chmod(java, 0o755).catch(() => {});
  return java;
}

type LaunchSpec = { executable: string; args: string[]; env?: Record<string, string | undefined> };

async function launchSpec(server: Server): Promise<LaunchSpec> {
  const root = serverDir(server);
  if (server.launchCommand.trim()) {
    let executable = server.launchCommand.trim();
    if ((executable.includes("/") || executable.includes("\\") || executable.startsWith(".")) && !path.isAbsolute(executable)) executable = path.resolve(root, executable);
    const args = parseArgs(server.launchArgs);
    if (process.platform === "win32" && /\.(?:bat|cmd)$/i.test(executable)) {
      return { executable: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `call "${executable}" ${server.launchArgs}`] };
    }
    return { executable, args };
  }

  if (server.gameId === "minecraft" || server.gameId === "minecraft-modded") {
    const jar = path.join(root, "server.jar");
    if (!fs.existsSync(jar)) throw new Error("server.jar is missing. Retry installation first.");
    const java = await ensureJava(server.id, javaMajorForMinecraft(server.version));
    return { executable: java, args: [`-Xms${Math.min(1024, server.memoryMb)}M`, `-Xmx${server.memoryMb}M`, "-jar", jar, "nogui"] };
  }
  if (server.gameId === "minecraft-bedrock") {
    const executable = path.join(root, process.platform === "win32" ? "bedrock_server.exe" : "bedrock_server");
    if (!fs.existsSync(executable)) throw new Error("Bedrock server executable is missing. Retry installation first.");
    return { executable, args: [], env: process.platform === "linux" ? { LD_LIBRARY_PATH: root } : undefined };
  }
  if (server.gameId === "valheim") {
    const executable = await findExecutable(root, process.platform === "win32" ? ["valheim_server.exe"] : ["valheim_server.x86_64"]);
    if (!executable) throw new Error("Valheim server executable was not found after SteamCMD installation.");
    if (!server.serverPassword || server.serverPassword.length < 5) throw new Error("Valheim requires a server password of at least five characters.");
    return {
      executable,
      args: ["-nographics", "-batchmode", "-name", server.name, "-port", String(server.port), "-world", server.worldName, "-password", server.serverPassword, "-public", "1"],
      env: process.platform === "linux" ? { LD_LIBRARY_PATH: `${path.dirname(executable)}/linux64:${process.env.LD_LIBRARY_PATH || ""}` } : undefined,
    };
  }
  if (server.gameId === "ark") {
    const executable = await findExecutable(root, process.platform === "win32"
      ? ["ShooterGame/Binaries/Win64/ShooterGameServer.exe", "ShooterGameServer.exe"]
      : ["ShooterGame/Binaries/Linux/ShooterGameServer", "ShooterGameServer"]);
    if (!executable) throw new Error("ARK server executable was not found after SteamCMD installation.");
    const map = server.worldName || "TheIsland";
    return { executable, args: [`${map}?SessionName=${server.name}?Port=${server.port}?QueryPort=${getGame(server.gameId).queryPort ?? 27015}?MaxPlayers=${server.maxPlayers}`, "-server", "-log"] };
  }
  if (server.gameId === "terraria") {
    const executable = await findExecutable(root, process.platform === "win32"
      ? ["TerrariaServer.exe"]
      : ["TerrariaServer.bin.x86_64", "TerrariaServer"]);
    if (!executable) throw new Error("Terraria server executable was not found after SteamCMD installation.");
    return { executable, args: ["-config", path.join(root, "serverconfig.txt")] };
  }
  if (server.gameId === "rust") {
    const executable = await findExecutable(root, process.platform === "win32" ? ["RustDedicated.exe"] : ["RustDedicated"]);
    if (!executable) throw new Error("RustDedicated executable was not found after SteamCMD installation.");
    return { executable, args: [
      "-batchmode", "+server.identity", safeFileName(server.worldName, "serverhub"),
      "+server.hostname", server.name, "+server.port", String(server.port),
      "+server.queryport", String(getGame(server.gameId).queryPort ?? server.port + 1),
      "+server.maxplayers", String(server.maxPlayers), "+server.seed", server.seed || "0",
      "+server.description", server.motd,
    ] };
  }
  throw new Error("This manual server needs a launch command in Settings.");
}

// ---------------------------------------------------------------------------
// Real process lifecycle and metrics
// ---------------------------------------------------------------------------

export async function startFlow(id: number): Promise<{ ok: boolean; reason?: string }> {
  await ensureRuntimeInitialized();
  const [server] = await db.select().from(servers).where(eq(servers.id, id));
  if (!server) return { ok: false, reason: "Server not found" };
  if (state.processes.has(id)) return { ok: false, reason: "Server process is already running" };
  if (state.installs.has(id) || server.status === "installing") return { ok: false, reason: "Installation is still running" };
  if (server.status === "error") return { ok: false, reason: "Installation failed. Retry installation first." };

  try {
    await writeServerConfig(server);
    await setStatus(id, "starting");
    await logLine(id, "system", "Runtime", `Starting ${server.name} from ${serverDir(server)}`);
    const spec = await launchSpec(server);
    const env = { ...process.env, ...spec.env };
    const child = spawn(spec.executable, spec.args, {
      cwd: serverDir(server),
      env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const entry = {
      child,
      server,
      metrics: [],
      monitor: undefined as unknown as NodeJS.Timeout,
      stopping: false,
      restarting: false,
      lineCount: 0,
    } satisfies RuntimeEntry;
    state.processes.set(id, entry);
    pipeLines(entry, child.stdout, false);
    pipeLines(entry, child.stderr, true);

    child.once("error", (error) => {
      void logLine(id, "error", "Runtime", `Could not launch process: ${error.message}`).catch(() => {});
    });
    child.once("exit", (code, signal) => void handleExit(entry, code, signal));
    entry.monitor = setInterval(() => void sampleEntry(entry).catch(() => {}), 2_000);
    entry.monitor.unref?.();

    await new Promise((resolve) => setTimeout(resolve, 700));
    if (!state.processes.has(id)) return { ok: false, reason: "The server process exited during startup. Check Console for details." };
    await db.update(servers).set({ status: "online", lastStartedAt: new Date(), updatedAt: new Date() }).where(eq(servers.id, id));
    await logLine(id, "success", "Runtime", `Process started with PID ${child.pid}.`);
    await act(id, "power", `${server.name} started (PID ${child.pid})`);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setStatus(id, "crashed");
    await logLine(id, "error", "Runtime", message);
    return { ok: false, reason: message };
  }
}

async function handleExit(entry: RuntimeEntry, code: number | null, signal: NodeJS.Signals | null) {
  const id = entry.server.id;
  clearInterval(entry.monitor);
  if (state.processes.get(id) === entry) state.processes.delete(id);
  await db.update(players).set({ isOnline: false }).where(eq(players.serverId, id)).catch(() => {});
  const expected = entry.stopping;
  await setStatus(id, expected ? "offline" : "crashed").catch(() => {});
  await logLine(id, expected ? "system" : "error", "Runtime", `Process exited (code ${code ?? "none"}, signal ${signal ?? "none"}).`).catch(() => {});
  await act(id, "power", `${entry.server.name} ${expected ? "stopped" : "crashed"}`).catch(() => {});
  if (entry.restarting && !state.closing) setTimeout(() => void startFlow(id), 900);
}

function stopCommand(server: Server): string {
  if (server.gameId === "minecraft" || server.gameId === "minecraft-modded" || server.gameId === "minecraft-bedrock") return "stop";
  if (server.gameId === "terraria") return "exit";
  if (server.gameId === "rust") return "quit";
  if (server.gameId === "ark") return "DoExit";
  return "stop";
}

export async function stopFlow(id: number, reason = "Panel"): Promise<{ ok: boolean; reason?: string }> {
  await ensureRuntimeInitialized();
  const entry = state.processes.get(id);
  if (!entry) {
    await setStatus(id, "offline");
    return { ok: false, reason: "No running process is attached" };
  }
  if (entry.stopping) return { ok: false, reason: "Server is already stopping" };
  entry.stopping = true;
  await setStatus(id, "stopping");
  await logLine(id, "system", "Runtime", `Graceful stop requested by ${reason}.`);
  try { entry.child.stdin.write(`${stopCommand(entry.server)}\n`); } catch { /* process may have closed */ }
  const timer = setTimeout(() => {
    if (state.processes.get(id) === entry) {
      void logLine(id, "warn", "Runtime", "Graceful stop timed out after 30 seconds; terminating the process tree.").catch(() => {});
      killProcessTree(entry.child.pid, true);
    }
  }, 30_000);
  timer.unref?.();
  return { ok: true };
}

export async function restartFlow(id: number): Promise<{ ok: boolean; reason?: string }> {
  await ensureRuntimeInitialized();
  const entry = state.processes.get(id);
  if (!entry) return startFlow(id);
  entry.restarting = true;
  return stopFlow(id, "Restart");
}

export async function killFlow(id: number) {
  await ensureRuntimeInitialized();
  const entry = state.processes.get(id);
  if (!entry) {
    await setStatus(id, "offline");
    return { ok: false, reason: "No running process is attached" };
  }
  entry.stopping = true;
  entry.restarting = false;
  await logLine(id, "error", "Runtime", "Force-killing the process tree; unsaved data may be lost.");
  killProcessTree(entry.child.pid, true);
  return { ok: true };
}

function killProcessTree(pid: number | undefined, force: boolean) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/t", ...(force ? ["/f"] : [])], { windowsHide: true, stdio: "ignore" }).unref();
    } else {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
    }
  } catch {
    try { process.kill(pid, force ? "SIGKILL" : "SIGTERM"); } catch { /* already gone */ }
  }
}

export async function runCommand(server: Server, raw: string, issuer = "you") {
  await ensureRuntimeInitialized();
  const input = raw.trim();
  if (!input) return { ok: false, reason: "Empty command" };
  const entry = state.processes.get(server.id);
  await logLine(server.id, "command", issuer === "Scheduler" ? "Scheduler" : "Console", input);
  if (!entry || entry.child.stdin.destroyed) {
    await logLine(server.id, "warn", "Runtime", "Command was not sent because the server process is offline.");
    return { ok: false, reason: "Server is offline" };
  }
  entry.child.stdin.write(`${input.replace(/^\//, "")}\n`);
  return { ok: true };
}

async function sampleEntry(entry: RuntimeEntry) {
  if (!entry.child.pid || !state.processes.has(entry.server.id)) return;
  const proc = await processUsage(entry.child.pid, entry.sample);
  if (proc.sample) entry.sample = proc.sample;
  const online = await db.select({ id: players.id }).from(players).where(and(eq(players.serverId, entry.server.id), eq(players.isOnline, true)));
  entry.metrics.push({ t: Date.now(), cpu: proc.cpu, ram: proc.ram, players: online.length, tps: null });
  if (entry.metrics.length > 240) entry.metrics.shift();
}

async function processUsage(pid: number, previous?: ProcSample): Promise<{ cpu: number; ram: number; sample?: ProcSample }> {
  try {
    if (process.platform === "linux") {
      const stat = await fsp.readFile(`/proc/${pid}/stat`, "utf8");
      const end = stat.lastIndexOf(")");
      const fields = stat.slice(end + 2).split(" ");
      const ticks = Number(fields[11]) + Number(fields[12]);
      const rssPages = Number(fields[21]);
      const now = Date.now();
      const cpu = previous ? Math.max(0, Math.min(100, ((ticks - previous.cpuTime) / 100) / ((now - previous.at) / 1000) * 100)) : 0;
      return { cpu: +cpu.toFixed(1), ram: Math.max(0, Math.round((rssPages * 4096) / 1024 / 1024)), sample: { at: now, cpuTime: ticks } };
    }
    const result = await new Promise<string>((resolve, reject) => {
      const child = process.platform === "win32"
        ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}) | ForEach-Object { \"$($_.CPU)|$($_.WorkingSet64)\" }`], { windowsHide: true })
        : spawn("ps", ["-o", "%cpu=,rss=", "-p", String(pid)]);
      let out = "";
      child.stdout.on("data", (data) => out += String(data));
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve(out.trim()) : reject(new Error("process unavailable")));
    });
    if (process.platform === "win32") {
      const [seconds, bytes] = result.split("|").map(Number);
      const now = Date.now();
      const cpuTime = seconds * 100;
      const cpu = previous ? Math.max(0, Math.min(100, (cpuTime - previous.cpuTime) / (now - previous.at) * 1000)) : 0;
      return { cpu: +cpu.toFixed(1), ram: Math.round(bytes / 1024 / 1024), sample: { at: now, cpuTime } };
    }
    const [cpu, kb] = result.split(/\s+/).map(Number);
    return { cpu: Math.min(100, cpu || 0), ram: Math.round((kb || 0) / 1024) };
  } catch {
    return { cpu: 0, ram: 0, sample: previous };
  }
}

export async function metricsFor(server: Server): Promise<Metric[]> {
  await ensureRuntimeInitialized();
  const entry = state.processes.get(server.id);
  return entry?.metrics ?? [];
}

// ---------------------------------------------------------------------------
// Real backups
// ---------------------------------------------------------------------------

async function hashFile(file: string) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(file);
  stream.on("data", (chunk) => hash.update(chunk));
  await finished(stream);
  return hash.digest("hex");
}

export async function createBackup(id: number, label?: string, by = "you") {
  await ensureRuntimeInitialized();
  const [server] = await db.select().from(servers).where(eq(servers.id, id));
  if (!server) return null;
  const root = serverDir(server);
  const name = safeFileName(label?.trim() || `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const [row] = await db.insert(backups).values({ serverId: id, name, status: "building", note: `Requested by ${by}` }).returning();
  const directory = backupsDir(id);
  const archive = path.join(directory, `${String(row.id).padStart(6, "0")}-${name}.tar.gz`);

  void (async () => {
    try {
      await fsp.mkdir(directory, { recursive: true });
      const entries = await fsp.readdir(root);
      if (!entries.length) throw new Error("The server directory is empty.");
      await logLine(id, "system", "Backup", `Creating ${path.basename(archive)} from ${root}`);
      await tar.c({ cwd: root, file: archive, gzip: true, portable: true, strict: true }, entries);
      const stat = await fsp.stat(archive);
      const checksum = await hashFile(archive);
      const sizeMb = Math.max(1, Math.ceil(stat.size / 1024 / 1024));
      await db.update(backups).set({ status: "complete", sizeMb, archivePath: archive, checksum }).where(eq(backups.id, row.id));
      await logLine(id, "success", "Backup", `Backup complete: ${path.basename(archive)} (${sizeMb} MB, SHA-256 ${checksum.slice(0, 12)}…).`);
      await act(id, "backup", `Backup "${name}" completed (${sizeMb} MB)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(backups).set({ status: "failed", note: message, archivePath: archive }).where(eq(backups.id, row.id));
      await fsp.rm(archive, { force: true }).catch(() => {});
      await logLine(id, "error", "Backup", `Backup failed: ${message}`);
    }
  })();
  return row;
}

export function backupArchivePath(backup: Backup): string {
  return backup.archivePath || path.join(backupsDir(backup.serverId), `${String(backup.id).padStart(6, "0")}-${safeFileName(backup.name)}.tar.gz`);
}

export async function deleteBackupFile(backup: Backup) {
  await fsp.rm(backupArchivePath(backup), { force: true });
}

export async function restoreBackup(serverId: number, backupId: number) {
  await ensureRuntimeInitialized();
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId));
  const [backup] = await db.select().from(backups).where(and(eq(backups.id, backupId), eq(backups.serverId, serverId)));
  if (!server || !backup) return { ok: false, reason: "Backup not found" };
  if (state.processes.has(serverId) || !["offline", "crashed", "error"].includes(server.status)) return { ok: false, reason: "Stop the server before restoring" };
  if (backup.status !== "complete") return { ok: false, reason: "Backup is not complete" };
  const archive = backupArchivePath(backup);
  if (!fs.existsSync(/*turbopackIgnore: true*/ archive)) return { ok: false, reason: "Backup archive is missing from disk" };
  const checksum = await hashFile(archive);
  if (backup.checksum && checksum !== backup.checksum) return { ok: false, reason: "Backup checksum verification failed" };

  const root = serverDir(server);
  const old = `${root}.restore-old-${Date.now()}`;
  try {
    await logLine(serverId, "system", "Backup", `Restoring ${path.basename(archive)} (checksum verified).`);
    if (fs.existsSync(root)) await fsp.rename(root, old);
    await fsp.mkdir(root, { recursive: true });
    await tar.x({ cwd: root, file: archive, gzip: true, strict: true, preservePaths: false });
    await fsp.rm(old, { recursive: true, force: true });
    await logLine(serverId, "success", "Backup", `Restore complete: ${backup.name}.`);
    await act(serverId, "backup", `Restored backup "${backup.name}"`);
    return { ok: true };
  } catch (error) {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
    if (fs.existsSync(old)) await fsp.rename(old, root).catch(() => {});
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Scheduler and logs
// ---------------------------------------------------------------------------

export async function sweepTasks(serverId?: number) {
  await ensureRuntimeInitialized();
  if (state.sweeping) return;
  state.sweeping = true;
  try {
    const now = new Date();
    const enabled = await db.select().from(tasks).where(eq(tasks.enabled, true));
    for (const task of enabled) {
      if (serverId && task.serverId !== serverId) continue;
      if (!task.nextRunAt || task.nextRunAt > now) continue;
      await db.update(tasks).set({ lastRunAt: now, nextRunAt: new Date(now.getTime() + Math.max(1, task.intervalMin) * 60_000) }).where(eq(tasks.id, task.id));
      const [server] = await db.select().from(servers).where(eq(servers.id, task.serverId));
      if (!server) continue;
      if (task.type === "backup") await createBackup(server.id, `auto-${safeFileName(task.name)}`, "scheduler");
      else if (task.type === "restart") {
        if (state.processes.has(server.id)) await restartFlow(server.id);
        else await logLine(server.id, "warn", "Scheduler", `Skipped "${task.name}": server is offline.`);
      } else if (task.type === "broadcast") await runCommand(server, `say ${task.payload}`, "Scheduler");
      else if (task.type === "command") await runCommand(server, task.payload, "Scheduler");
      await act(server.id, "task", `Scheduled task "${task.name}" executed`);
    }
  } finally {
    state.sweeping = false;
  }
}

export async function getLogs(serverId: number, after?: number) {
  if (after && Number.isFinite(after)) {
    return db.select().from(consoleLogs).where(and(eq(consoleLogs.serverId, serverId), gt(consoleLogs.id, after))).orderBy(asc(consoleLogs.id)).limit(500);
  }
  const rows = await db.select().from(consoleLogs).where(eq(consoleLogs.serverId, serverId)).orderBy(asc(consoleLogs.id)).limit(10_000);
  return rows.slice(-500);
}

export async function fleetHealth() {
  await ensureRuntimeInitialized();
  let cpu = 0;
  let ram = 0;
  let playersOnline = 0;
  for (const entry of state.processes.values()) {
    const metric = entry.metrics.at(-1);
    cpu += metric?.cpu ?? 0;
    ram += metric?.ram ?? 0;
    playersOnline += metric?.players ?? 0;
  }
  const all = await db.select({ id: servers.id }).from(servers);
  return { cpu: +cpu.toFixed(1), ram, online: state.processes.size, playersOnline, total: all.length };
}
