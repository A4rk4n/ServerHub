import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import dgram from "node:dgram";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import * as tar from "tar";
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, dbPath, sqliteClient } from "@/db";
import { activity, backups, consoleLogs, incidents, installationEvents, installationJobs, moderationActions, playerSessions, players, servers, tasks } from "@/db/schema";
import type { Backup, InstallationJob, Server } from "@/db/schema";
import { getGame, type InstallerKind } from "./games";
import { observationKey, reconcileObservationKeys } from "./player-observations";
import { queryA2sInfo, queryA2sPlayers, queryMinecraftStatus } from "./query-protocols";
import { isProtectedSecret, protectAndVerify, revealSecret } from "./credential-vault";
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
  startedAtMs: number;
};

type ActiveInstallation = {
  jobId: number;
  controller: AbortController;
  done: Promise<void>;
};

type RuntimeState = {
  processes: Map<number, RuntimeEntry>;
  installs: Map<number, ActiveInstallation>;
  restartTimers: Map<number, NodeJS.Timeout>;
  crashHistory: Map<number, number[]>;
  initialized?: Promise<void>;
  scheduler?: NodeJS.Timeout;
  installPumpScheduled: boolean;
  installPumpRunning: boolean;
  sweeping: boolean;
  closing: boolean;
};

const globalRuntime = globalThis as typeof globalThis & { __serverHubRuntime?: RuntimeState };
const state: RuntimeState =
  globalRuntime.__serverHubRuntime ??
  ({
    processes: new Map(),
    installs: new Map(),
    restartTimers: new Map(),
    crashHistory: new Map(),
    installPumpScheduled: false,
    installPumpRunning: false,
    sweeping: false,
    closing: false,
  } satisfies RuntimeState);
// Hot reload can retain state created by an older runtime module.
if (!(state.installs instanceof Map)) state.installs = new Map();
if (!(state.restartTimers instanceof Map)) state.restartTimers = new Map();
if (!(state.crashHistory instanceof Map)) state.crashHistory = new Map();
state.installPumpScheduled ??= false;
state.installPumpRunning ??= false;
globalRuntime.__serverHubRuntime = state;

export { redactLogSecrets } from "./support-redaction";
import { redactLogSecrets } from "./support-redaction";

export async function logLine(serverId: number, level: string, source: string, message: string) {
  const clean = redactLogSecrets(message).replace(/\0/g, "").slice(0, 16_000);
  await db.insert(consoleLogs).values({ serverId, level, source, message: clean });
}

export async function act(serverId: number | null, kind: string, message: string) {
  await db.insert(activity).values({ serverId, kind, message: message.slice(0, 1000) });
}

export async function setStatus(id: number, status: string) {
  await db.update(servers).set({ status, updatedAt: new Date() }).where(eq(servers.id, id));
}

async function setHealth(id:number,status:string,reason:string,probe:string,success:boolean){
 const [current]=await db.select({failures:servers.healthFailures}).from(servers).where(eq(servers.id,id)); const failures=success?0:(current?.failures??0)+1;
 await db.update(servers).set({healthStatus:success?status:(failures>=3?status:"checking"),healthReason:reason,healthProbe:probe,healthFailures:failures,...(success?{lastHealthSuccessAt:new Date()}:{lastHealthFailureAt:new Date()}),updatedAt:new Date()}).where(eq(servers.id,id));
 return failures;
}
async function incident(serverId:number,severity:string,component:string,summary:string,remediation=""){await db.insert(incidents).values({serverId,severity,component,summary:redactLogSecrets(summary),remediation:redactLogSecrets(remediation)});}


async function migrateCredentialVault() {
  if (process.platform !== "win32") return;
  const rows = await db.select().from(servers);
  const pending = rows.filter(row => [row.serverPassword,row.adminPassword,row.ownerId].some(value => value && !isProtectedSecret(value)));
  const marker = path.join(appDataDir(), "credential-migration.json");
  if (!pending.length) { await fsp.rm(marker,{force:true}).catch(()=>{}); return; }
  const prior = await fsp.readFile(marker,"utf8").then(value=>JSON.parse(value) as {backup:string}).catch(()=>null);
  const backup = prior?.backup ?? `${dbPath}.pre-dpapi-${new Date().toISOString().replace(/[:.]/g,"-")}.bak`;
  if (!prior) {
    sqliteClient().exec("PRAGMA wal_checkpoint(FULL)");
    await fsp.copyFile(dbPath,backup);
    await fsp.writeFile(marker,JSON.stringify({version:1,phase:"prepared",backup,serverIds:pending.map(row=>row.id),createdAt:new Date().toISOString()},null,2));
  }
  try {
    const encrypted = await Promise.all(pending.map(async row => ({ id: row.id, serverPassword: await protectAndVerify(row.serverPassword), adminPassword: await protectAndVerify(row.adminPassword), ownerId: await protectAndVerify(row.ownerId) })));
    await fsp.writeFile(marker,JSON.stringify({version:1,phase:"applying",backup,serverIds:pending.map(row=>row.id),createdAt:new Date().toISOString()},null,2));
    await db.transaction(async tx => { for (const row of encrypted) await tx.update(servers).set({serverPassword:row.serverPassword,adminPassword:row.adminPassword,ownerId:row.ownerId,updatedAt:new Date()}).where(eq(servers.id,row.id)); });
    await fsp.rm(marker,{force:true});
  } catch (error) {
    await fsp.writeFile(marker,JSON.stringify({version:1,phase:"failed",backup,error:error instanceof Error?error.message:String(error),failedAt:new Date().toISOString()},null,2)).catch(()=>{});
    throw new Error(`Credential migration failed without changing plaintext credentials. Recovery backup: ${backup}`);
  }
}

async function initializeRuntime() {
  ensureDataDirs();
  await migrateCredentialVault();
  await recoverInstallationQueue();
  const activeJobs = await db
    .select({ serverId: installationJobs.serverId })
    .from(installationJobs)
    .where(inArray(installationJobs.status, ["queued", "running", "cancelling"]));
  const installingServers = new Set(activeJobs.map((job) => job.serverId));
  const rows = await db.select().from(servers);
  for (const server of rows) {
    if (["online", "starting", "stopping"].includes(server.status)) {
      await setStatus(server.id, "crashed");
      await logLine(server.id, "warn", "Runtime", "The Server Hub runtime restarted; the previous process is no longer attached.");
    } else if (server.status === "installing" && !installingServers.has(server.id)) {
      // Compatibility with databases created before durable installation jobs.
      await setStatus(server.id, "error");
      await logLine(server.id, "warn", "Installer", "A legacy installation was interrupted. Retry installation to create a recoverable job.");
    }
    await db.update(players).set({ isOnline: false }).where(eq(players.serverId, server.id));
  }
  scheduleInstallPump();

  if (!state.scheduler) {
    state.scheduler = setInterval(() => void sweepTasks().catch(() => {}), 15_000);
    state.scheduler.unref?.();
  }

  const shutdown = () => {
    if (state.closing) return;
    state.closing = true;
    if (state.scheduler) { clearInterval(state.scheduler); state.scheduler = undefined; }
    for (const timer of state.restartTimers.values()) clearTimeout(timer);
    state.restartTimers.clear();
    for (const install of state.installs.values()) install.controller.abort("Server Hub is shutting down");
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
  process.once("serverhub:shutdown", shutdown);
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
// Durable installation jobs
// ---------------------------------------------------------------------------

type InstallPhase =
  | "queued"
  | "preflight"
  | "preparing"
  | "downloading"
  | "installing"
  | "validating"
  | "configuring"
  | "activating"
  | "completed"
  | "failed"
  | "cancelled";

type InstallContext = {
  jobId: number;
  serverId: number;
  signal: AbortSignal;
  report: (phase: InstallPhase, progress: number, message: string, level?: string) => Promise<void>;
  transfer: (progress: number, bytesDone: number, bytesTotal: number, message: string) => Promise<void>;
};

class InstallationCancelledError extends Error {
  constructor(message = "Installation cancelled") {
    super(message);
    this.name = "InstallationCancelledError";
  }
}

const ACTIVE_INSTALL_STATUSES = ["queued", "running", "cancelling"] as const;
const MAX_CONCURRENT_INSTALLATIONS = 1;

function cancellationMessage(signal: AbortSignal) {
  return typeof signal.reason === "string" && signal.reason.trim() ? signal.reason : "Installation cancelled";
}

function throwIfCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new InstallationCancelledError(cancellationMessage(signal));
}

function cleanInstallMessage(message: string, limit = 2_000) {
  const clean = message.replace(/\0/g, "").replace(/[\r\n]+/g, " ").trim();
  const friendly = /spawn\s+EFTYPE/i.test(clean)
    ? "Windows could not launch an installation tool. Its executable may be damaged or incompatible; choose Repair and retry."
    : /\bENOENT\b/i.test(clean)
      ? "A required installation tool or file is missing; choose Repair and retry."
      : /\bEACCES\b|access is denied/i.test(clean)
        ? "Windows denied access to an installation file. Check antivirus, folder permissions, and run Repair and retry."
        : /EADDRNOTAVAIL/i.test(clean)
          ? "The configured bind address is not assigned to this PC. Select an address shown in Diagnostics."
          : /EADDRINUSE/i.test(clean)
            ? "The selected port is already being used by another program or server."
            : clean;
  return friendly.slice(0, limit);
}

async function addInstallationEvent(
  jobId: number,
  serverId: number,
  level: string,
  phase: string,
  progress: number,
  message: string
) {
  await db.insert(installationEvents).values({
    jobId,
    serverId,
    level,
    phase,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    message: cleanInstallMessage(message),
  });
}

async function recoverInstallationQueue() {
  const interrupted = await db
    .select()
    .from(installationJobs)
    .where(inArray(installationJobs.status, ["running", "cancelling"]));
  for (const job of interrupted) {
    await db
      .update(installationJobs)
      .set({
        status: "queued",
        phase: "queued",
        message: "Server Hub restarted; installation queued for automatic recovery",
        error: "",
        cancelRequested: false,
        attempt: sql`${installationJobs.attempt} + 1`,
        updatedAt: new Date(),
        startedAt: null,
        completedAt: null,
      })
      .where(eq(installationJobs.id, job.id));
    await setStatus(job.serverId, "installing");
    await addInstallationEvent(
      job.id,
      job.serverId,
      "warn",
      "queued",
      job.progress,
      "The application restarted during installation. The job will resume automatically."
    );
    await logLine(job.serverId, "warn", "Installer", "Interrupted installation recovered and returned to the queue.");
  }
}

function scheduleInstallPump() {
  if (state.installPumpScheduled || state.closing) return;
  state.installPumpScheduled = true;
  setImmediate(() => {
    state.installPumpScheduled = false;
    void pumpInstallQueue().catch((error) => console.error("[serverhub] installation queue failed", error));
  });
}

async function pumpInstallQueue() {
  if (state.installPumpRunning || state.closing) return;
  state.installPumpRunning = true;
  try {
    while (state.installs.size < MAX_CONCURRENT_INSTALLATIONS && !state.closing) {
      const [job] = await db
        .select()
        .from(installationJobs)
        .where(eq(installationJobs.status, "queued"))
        .orderBy(asc(installationJobs.id))
        .limit(1);
      if (!job) break;
      const [server] = await db.select().from(servers).where(eq(servers.id, job.serverId));
      if (!server) {
        await db
          .update(installationJobs)
          .set({
            status: "failed",
            phase: "failed",
            error: "The server entry no longer exists",
            message: "Installation failed",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(installationJobs.id, job.id));
        continue;
      }
      if (state.installs.has(server.id)) break;

      const controller = new AbortController();
      const claimed = await db
        .update(installationJobs)
        .set({
          status: "running",
          phase: "preflight",
          message: "Checking installation requirements",
          error: "",
          cancelRequested: false,
          startedAt: new Date(),
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(installationJobs.id, job.id), eq(installationJobs.status, "queued")))
        .returning({ id: installationJobs.id });
      if (claimed.length === 0) continue;

      const active: ActiveInstallation = { jobId: job.id, controller, done: Promise.resolve() };
      state.installs.set(server.id, active);
      active.done = executeInstallation(job, server, controller.signal).finally(() => {
        if (state.installs.get(server.id) === active) state.installs.delete(server.id);
        scheduleInstallPump();
      });
    }
  } finally {
    state.installPumpRunning = false;
  }
}

async function latestInstallationJob(serverId: number): Promise<InstallationJob | undefined> {
  const [job] = await db
    .select()
    .from(installationJobs)
    .where(eq(installationJobs.serverId, serverId))
    .orderBy(desc(installationJobs.id))
    .limit(1);
  return job;
}

export async function installFlow(id: number): Promise<{ ok: boolean; reason?: string; jobId?: number }> {
  await ensureRuntimeInitialized();
  const [storedServer] = await db.select().from(servers).where(eq(servers.id, id));
  if (!storedServer) return { ok: false, reason: "Server not found" };
  const server = { ...storedServer, serverPassword: await revealSecret(storedServer.serverPassword), adminPassword: await revealSecret(storedServer.adminPassword), ownerId: await revealSecret(storedServer.ownerId) };
  if (state.processes.has(id) || state.restartTimers.has(id)) return { ok: false, reason: "Stop the server and cancel any pending restart before installing or updating it" };

  const [active] = await db
    .select()
    .from(installationJobs)
    .where(and(eq(installationJobs.serverId, id), inArray(installationJobs.status, [...ACTIVE_INSTALL_STATUSES])))
    .orderBy(desc(installationJobs.id))
    .limit(1);
  if (active) return { ok: false, reason: "Installation is already queued or running", jobId: active.id };

  const previous = await latestInstallationJob(id);
  let job: InstallationJob;
  if (previous && ["failed", "cancelled"].includes(previous.status) && server.status === "error") {
    [job] = await db
      .update(installationJobs)
      .set({
        status: "queued",
        phase: "queued",
        progress: 0,
        bytesDone: 0,
        bytesTotal: 0,
        message: "Waiting to retry installation",
        error: "",
        cancelRequested: false,
        attempt: sql`${installationJobs.attempt} + 1`,
        updatedAt: new Date(),
        startedAt: null,
        completedAt: null,
      })
      .where(eq(installationJobs.id, previous.id))
      .returning();
  } else {
    [job] = await db
      .insert(installationJobs)
      .values({
        serverId: id,
        kind: server.status === "offline" ? "update" : "install",
        status: "queued",
        phase: "queued",
        progress: 0,
        message: "Waiting for the installer",
      })
      .returning();
  }

  await setStatus(id, "installing");
  await addInstallationEvent(job.id, id, "info", "queued", job.progress, job.message);
  await logLine(id, "system", "Installer", `Installation job #${job.id} queued (attempt ${job.attempt}).`);
  scheduleInstallPump();
  return { ok: true, jobId: job.id };
}

export async function repairInstallation(id: number): Promise<{ ok: boolean; reason?: string; jobId?: number }> {
  await ensureRuntimeInitialized();
  const [server] = await db.select().from(servers).where(eq(servers.id, id));
  if (!server) return { ok: false, reason: "Server not found" };
  const active = await latestInstallationJob(id);
  if (active && ACTIVE_INSTALL_STATUSES.includes(active.status as (typeof ACTIVE_INSTALL_STATUSES)[number])) return { ok: false, reason: "Cancel the active installation before repairing tools" };
  const installer = getGame(server.gameId).installer;
  if (installer === "steamcmd") {
    await fsp.rm(path.join(toolsDir(), "steamcmd"), { recursive: true, force: true });
    await fsp.rm(path.join(appDataDir(), "downloads", process.platform === "win32" ? "steamcmd.zip" : "steamcmd.tar.gz"), { force: true });
  } else if (installer === "hytale") {
    await fsp.rm(path.join(toolsDir(), "hytale-downloader"), { recursive: true, force: true });
    await fsp.rm(path.join(appDataDir(), "downloads", "hytale-downloader.zip"), { force: true });
  }
  await logLine(id, "system", "Repair", `Cleared cached ${installer} installation tools and downloads.`);
  await act(id, "repair", `Repaired installation tools for ${server.name}`);
  return installFlow(id);
}

export async function cancelInstallation(id: number, wait = false): Promise<{ ok: boolean; reason?: string }> {
  await ensureRuntimeInitialized();
  const [job] = await db
    .select()
    .from(installationJobs)
    .where(and(eq(installationJobs.serverId, id), inArray(installationJobs.status, [...ACTIVE_INSTALL_STATUSES])))
    .orderBy(desc(installationJobs.id))
    .limit(1);
  if (!job) return { ok: false, reason: "No installation is queued or running" };

  if (job.status === "queued") {
    await db
      .update(installationJobs)
      .set({
        status: "cancelled",
        phase: "cancelled",
        message: "Installation cancelled",
        cancelRequested: true,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(installationJobs.id, job.id));
    await addInstallationEvent(job.id, id, "warn", "cancelled", job.progress, "Installation cancelled before it started.");
    await setStatus(id, "error");
    await logLine(id, "warn", "Installer", "Queued installation cancelled.");
    return { ok: true };
  }

  await db
    .update(installationJobs)
    .set({ status: "cancelling", cancelRequested: true, message: "Cancelling installation…", updatedAt: new Date() })
    .where(eq(installationJobs.id, job.id));
  await addInstallationEvent(job.id, id, "warn", job.phase, job.progress, "Cancellation requested.");
  const active = state.installs.get(id);
  if (active?.jobId === job.id) active.controller.abort("Cancelled by user");
  if (wait && active) {
    const finished = await Promise.race([
      active.done.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);
    if (!finished) return { ok: false, reason: "Installation cancellation is still in progress. Try deleting the server again shortly." };
  }
  return { ok: true };
}

async function reportInstallation(
  context: InstallContext,
  phase: InstallPhase,
  progress: number,
  message: string,
  level = "info"
) {
  throwIfCancelled(context.signal);
  const clean = cleanInstallMessage(message);
  const bounded = Math.max(0, Math.min(100, Math.round(progress)));
  await db
    .update(installationJobs)
    .set({ phase, progress: bounded, message: clean, updatedAt: new Date() })
    .where(eq(installationJobs.id, context.jobId));
  await addInstallationEvent(context.jobId, context.serverId, level, phase, bounded, clean);
  await logLine(context.serverId, level === "info" ? "system" : level, "Installer", clean);
}

async function updateTransfer(
  context: InstallContext,
  progress: number,
  bytesDone: number,
  bytesTotal: number,
  message: string
) {
  throwIfCancelled(context.signal);
  await db
    .update(installationJobs)
    .set({
      phase: "downloading",
      progress: Math.max(0, Math.min(100, Math.round(progress))),
      bytesDone: Math.max(0, Math.round(bytesDone)),
      bytesTotal: Math.max(0, Math.round(bytesTotal)),
      message: cleanInstallMessage(message),
      updatedAt: new Date(),
    })
    .where(eq(installationJobs.id, context.jobId));
}

async function downloadFile(
  url: string,
  destination: string,
  serverId: number,
  label: string,
  context?: InstallContext,
  progressRange: [number, number] = [20, 75]
) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    await logLine(serverId, "system", "Installer", `Using previously downloaded ${label}.`);
    return;
  }
  throwIfCancelled(context?.signal ?? new AbortController().signal);
  await logLine(serverId, "system", "Installer", `Downloading ${label}…`);
  const temp = `${destination}.download`;
  const partial = await fsp.stat(temp).then((stat) => stat.size).catch(() => 0);
  const headers: Record<string, string> = { "User-Agent": "ServerHub/1.1 (+local desktop server manager)" };
  if (partial > 0) headers.Range = `bytes=${partial}-`;
  const response = await fetch(url, { redirect: "follow", headers, signal: context?.signal });
  if (response.status === 416 && partial > 0) {
    await fsp.rm(temp, { force: true });
    return downloadFile(url, destination, serverId, label, context, progressRange);
  }
  if (!response.ok || !response.body) throw new Error(`${label} download failed: HTTP ${response.status}`);
  const resumed = partial > 0 && response.status === 206;
  const startAt = resumed ? partial : 0;
  const contentLength = Number(response.headers.get("content-length") || 0);
  const contentRange = response.headers.get("content-range") || "";
  const rangeTotal = Number(contentRange.match(/\/(\d+)$/)?.[1] || 0);
  const total = rangeTotal || (contentLength ? startAt + contentLength : 0);
  const output = fs.createWriteStream(temp, { flags: resumed ? "a" : "w" });
  let received = startAt;
  let lastUpdateAt = 0;
  let lastPercent = -10;
  const source = Readable.fromWeb(response.body as never);
  const abort = () => {
    source.destroy(new InstallationCancelledError(cancellationMessage(context!.signal)));
    output.destroy();
  };
  if (context) context.signal.addEventListener("abort", abort, { once: true });
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    const now = Date.now();
    const ratio = total ? Math.min(1, received / total) : 0;
    const percent = Math.floor(ratio * 100);
    if (context && (now - lastUpdateAt >= 500 || percent >= lastPercent + 2)) {
      lastUpdateAt = now;
      lastPercent = percent;
      const progress = progressRange[0] + ratio * (progressRange[1] - progressRange[0]);
      const suffix = total
        ? `${(received / 1024 / 1024).toFixed(1)} of ${(total / 1024 / 1024).toFixed(1)} MB`
        : `${(received / 1024 / 1024).toFixed(1)} MB`;
      void context.transfer(progress, received, total, `Downloading ${label} — ${suffix}`).catch(() => {});
    }
  });
  try {
    await pipeline(source, output);
  } finally {
    if (context) context.signal.removeEventListener("abort", abort);
  }
  throwIfCancelled(context?.signal ?? new AbortController().signal);
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

async function installMojang(server: Server, root: string, context: InstallContext) {
  await context.report("downloading", 15, "Reading Mojang's official version manifest");
  const manifestResponse = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", { signal: context.signal });
  if (!manifestResponse.ok) throw new Error(`Mojang version manifest failed: HTTP ${manifestResponse.status}`);
  const manifest = (await manifestResponse.json()) as { versions: { id: string; url: string }[] };
  const selected = manifest.versions.find((version) => version.id === server.version);
  if (!selected) throw new Error(`Minecraft ${server.version} is not present in Mojang's official manifest.`);
  const detailResponse = await fetch(selected.url, { signal: context.signal });
  if (!detailResponse.ok) throw new Error(`Minecraft ${server.version} metadata failed: HTTP ${detailResponse.status}`);
  const detail = (await detailResponse.json()) as { downloads?: { server?: { url: string; sha1: string } } };
  const artifact = detail.downloads?.server;
  if (!artifact) throw new Error(`Minecraft ${server.version} has no dedicated-server artifact.`);
  const jar = path.join(root, "server.jar");
  await downloadFile(artifact.url, jar, server.id, `Minecraft ${server.version} server`, context, [20, 76]);
  throwIfCancelled(context.signal);
  if ((await sha1(jar)) !== artifact.sha1) {
    await fsp.rm(jar, { force: true });
    throw new Error("Minecraft server checksum did not match Mojang metadata. The cached artifact was removed.");
  }
  await logLine(server.id, "success", "Installer", "Mojang SHA-1 checksum verified.");
}

async function installFabric(server: Server, root: string, context: InstallContext) {
  await context.report("downloading", 15, "Resolving the latest stable Fabric loader");
  const response = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(server.version)}`, { signal: context.signal });
  if (!response.ok) throw new Error(`Fabric does not publish a loader for Minecraft ${server.version} (HTTP ${response.status}).`);
  const versions = (await response.json()) as { loader: { version: string; stable: boolean }; installer: { version: string; stable: boolean } }[];
  const choice = versions.find((item) => item.loader.stable && item.installer.stable) ?? versions[0];
  if (!choice) throw new Error(`No Fabric loader is available for Minecraft ${server.version}.`);
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(server.version)}/${encodeURIComponent(choice.loader.version)}/${encodeURIComponent(choice.installer.version)}/server/jar`;
  await downloadFile(url, path.join(root, "server.jar"), server.id, `Fabric loader ${choice.loader.version}`, context, [20, 76]);
  await logLine(server.id, "success", "Installer", `Fabric ${choice.loader.version} installed for Minecraft ${server.version}.`);
}

async function installBedrock(server: Server, root: string, context: InstallContext) {
  if (!["win32", "linux"].includes(process.platform)) throw new Error("The official Bedrock server is only published for Windows and Linux.");
  await context.report("downloading", 14, "Locating the current official Bedrock server archive");
  const page = await fetch("https://www.minecraft.net/en-us/download/server/bedrock", {
    headers: { "User-Agent": "Mozilla/5.0 ServerHub/1.1" },
    signal: context.signal,
  });
  if (!page.ok) throw new Error(`Minecraft Bedrock download page failed: HTTP ${page.status}`);
  const html = (await page.text()).replaceAll("&amp;", "&").replaceAll("\\u0026", "&");
  const platform = process.platform === "win32" ? "win" : "linux";
  const matches = [...html.matchAll(/https:\/\/[^"'<>\\\s]+bedrock-server-[^"'<>\\\s]+\.zip/gi)].map((match) => match[0]);
  const url = matches.find((candidate) => candidate.toLowerCase().includes(`bin-${platform}`)) ?? matches.find((candidate) => candidate.toLowerCase().includes(platform));
  if (!url) throw new Error("Could not locate the official Bedrock archive. Microsoft may have changed its download page.");
  const archive = path.join(root, ".serverhub-downloads", "bedrock.zip");
  await downloadFile(url, archive, server.id, "Minecraft Bedrock server", context, [20, 68]);
  await context.report("installing", 72, "Extracting the Bedrock server archive");
  try {
    await extractZipSafe(archive, root, context.signal);
  } catch (error) {
    await fsp.rm(archive, { force: true });
    throw error;
  }
  await fsp.rm(path.dirname(archive), { recursive: true, force: true });
  if (process.platform !== "win32") await fsp.chmod(path.join(root, "bedrock_server"), 0o755).catch(() => {});
}

export async function extractZipSafe(archive: string, destination: string, signal?: AbortSignal, limits: { maxEntries?: number; maxExpandedBytes?: number } = {}) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, opened) => {
      if (error || !opened) reject(error ?? new Error("Could not open ZIP archive"));
      else resolve(opened);
    });
  });
  const root = path.resolve(destination);
  await fsp.mkdir(root, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let entryCount = 0;
    let expandedBytes = 0;
    const maxEntries = limits.maxEntries ?? 100_000;
    const maxExpandedBytes = limits.maxExpandedBytes ?? 20 * 1024 * 1024 * 1024;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      try { zip.close(); } catch { /* already closed */ }
      reject(error);
    };
    const abort = () => fail(new InstallationCancelledError(cancellationMessage(signal!)));
    signal?.addEventListener("abort", abort, { once: true });
    zip.once("error", fail);
    zip.once("end", () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve();
    });
    zip.on("entry", (entry) => {
      void (async () => {
        throwIfCancelled(signal ?? new AbortController().signal);
        entryCount += 1;
        expandedBytes += entry.uncompressedSize;
        if (entryCount > maxEntries) throw new Error(`ZIP entry limit exceeded (${maxEntries})`);
        if (!Number.isSafeInteger(expandedBytes) || expandedBytes > maxExpandedBytes) throw new Error(`ZIP expanded-size limit exceeded (${maxExpandedBytes} bytes)`);
        const normalized = entry.fileName.replaceAll("\\", "/");
        const target = path.resolve(root, normalized);
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const isSymlink = (unixMode & 0o170000) === 0o120000;
        const unsafe =
          !normalized ||
          isSymlink ||
          normalized.startsWith("/") ||
          /^[A-Za-z]:\//.test(normalized) ||
          normalized.split("/").includes("..") ||
          (target !== root && !target.startsWith(`${root}${path.sep}`));
        if (unsafe) throw new Error(`Unsafe ZIP entry rejected: ${entry.fileName}`);

        if (normalized.endsWith("/")) {
          await fsp.mkdir(target, { recursive: true });
        } else {
          await fsp.mkdir(path.dirname(target), { recursive: true });
          const input = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) => {
            zip.openReadStream(entry, (error, stream) => {
              if (error || !stream) rejectStream(error ?? new Error(`Could not read ${entry.fileName}`));
              else resolveStream(stream);
            });
          });
          const existing = await fsp.lstat(target).catch(() => null);
          if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error(`Unsafe ZIP target rejected: ${entry.fileName}`);
          const temp = `${target}.serverhub-extract-${process.pid}.tmp`;
          await pipeline(input, fs.createWriteStream(temp, { flags: "w" }));
          await fsp.rm(target, { force: true });
          await fsp.rename(temp, target);
          if (process.platform !== "win32" && (unixMode & 0o111)) await fsp.chmod(target, unixMode & 0o777).catch(() => {});
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}

async function extractTarGz(archive: string, destination: string) {
  await fsp.mkdir(destination, { recursive: true });
  await tar.x({ file: archive, cwd: destination, gzip: true, strict: true, preservePaths: false });
}

async function ensureSteamCmd(context: InstallContext): Promise<string> {
  const override = process.env.SERVERHUB_STEAMCMD_PATH;
  if (override && fs.existsSync(override)) return path.resolve(override);
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
  await downloadFile(url, archive, context.serverId, "SteamCMD", context, [12, 22]);
  throwIfCancelled(context.signal);
  try {
    if (process.platform === "win32") await extractZipSafe(archive, root, context.signal);
    else await extractTarGz(archive, root);
  } catch (error) {
    await fsp.rm(archive, { force: true });
    await fsp.rm(root, { recursive: true, force: true });
    throw error;
  }
  await fsp.rm(archive, { force: true });
  if (process.platform !== "win32") await fsp.chmod(executable, 0o755);
  return executable;
}

async function runLogged(context: InstallContext, executable: string, args: string[], cwd: string) {
  throwIfCancelled(context.signal);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      context.signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => {
      killProcessTree(child.pid, true);
      finish(new InstallationCancelledError(cancellationMessage(context.signal)));
    };
    context.signal.addEventListener("abort", cancel, { once: true });
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
          void logLine(context.serverId, inferLevel(line, isError), "Installer", line).catch(() => {});
          const steamProgress = line.match(/progress\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i);
          if (steamProgress) {
            const providerPercent = Math.max(0, Math.min(100, Number(steamProgress[1])));
            void context.transfer(25 + providerPercent * 0.55, 0, 0, `SteamCMD installation — ${providerPercent.toFixed(1)}%`).catch(() => {});
          }
        }
      });
    };
    read(child.stdout, false);
    read(child.stderr, true);
    child.once("error", (error) => finish(error));
    child.once("exit", (code) => {
      if (context.signal.aborted) finish(new InstallationCancelledError(cancellationMessage(context.signal)));
      else if (code === 0) finish();
      else finish(new Error(`Installer exited with code ${code}.${tail ? ` Last output:${tail}` : ""}`));
    });
  });
}

async function installSteam(server: Server, root: string, context: InstallContext) {
  const game = getGame(server.gameId);
  if (!game.steamAppId) throw new Error(`${game.name} has no verified SteamCMD application ID.`);
  const steamcmd = await ensureSteamCmd(context);
  await context.report("installing", 25, `Installing ${game.name} from official Steam app ${game.steamAppId}`);
  const steamArgs = [
    "+force_install_dir", root,
    "+login", "anonymous",
    "+app_update", String(game.steamAppId), "validate",
    "+quit",
  ];
  if (process.platform === "win32") {
    // Some Windows hosts/filesystems reject direct CreateProcess calls for
    // SteamCMD's 32-bit bootstrapper with spawn EFTYPE. PowerShell launches it
    // through Windows' native command resolution while preserving each arg.
    const ps = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const command = `$exe=${ps(steamcmd)}; $arguments=@(${steamArgs.map(ps).join(",")}); & $exe @arguments; exit $LASTEXITCODE`;
    await runLogged(context, "powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-Command", command,
    ], path.dirname(steamcmd));
  } else {
    await runLogged(context, steamcmd, steamArgs, path.dirname(steamcmd));
  }
}

async function ensureHytaleDownloader(context: InstallContext) {
  const override = process.env.SERVERHUB_HYTALE_DOWNLOADER_PATH;
  if (override && fs.existsSync(override)) return path.resolve(override);
  const root = path.join(toolsDir(), "hytale-downloader");
  const candidates = process.platform === "win32"
    ? ["hytale-downloader-windows-amd64.exe", "hytale-downloader.exe", "downloader.exe"]
    : ["hytale-downloader-linux-amd64", "hytale-downloader", "downloader"];
  const existing = await findExecutable(root, candidates);
  if (existing) return existing;
  if (!["win32", "linux"].includes(process.platform) || process.arch !== "x64") {
    throw new Error(`The official Hytale Downloader is not available for ${process.platform}/${process.arch}.`);
  }

  const archive = path.join(appDataDir(), "downloads", "hytale-downloader.zip");
  await downloadFile(
    "https://downloader.hytale.com/hytale-downloader.zip",
    archive,
    context.serverId,
    "official Hytale Downloader",
    context,
    [12, 22]
  );
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(root, { recursive: true });
  try {
    await extractZipSafe(archive, root, context.signal);
  } catch (error) {
    await fsp.rm(archive, { force: true });
    throw error;
  }
  await fsp.rm(archive, { force: true });
  const executable = await findExecutable(root, candidates);
  if (!executable) throw new Error("The official Hytale Downloader archive did not contain the expected executable.");
  if (process.platform !== "win32") await fsp.chmod(executable, 0o755).catch(() => {});
  return executable;
}

async function installHytale(server: Server, root: string, context: InstallContext) {
  const downloader = await ensureHytaleDownloader(context);
  const downloadDir = path.join(root, ".serverhub-downloads");
  const archive = path.join(downloadDir, "hytale-server.zip");
  await fsp.mkdir(downloadDir, { recursive: true });
  if (!fs.existsSync(archive)) {
    await context.report(
      "downloading",
      25,
      "Authorize the official Hytale Downloader using the URL and device code shown in Console"
    );
    await runLogged(context, downloader, ["-download-path", archive], path.dirname(downloader));
  } else {
    await context.report("downloading", 68, "Reusing the Hytale server archive downloaded by the previous attempt");
  }
  throwIfCancelled(context.signal);
  await context.report("installing", 72, "Securely extracting the official Hytale server archive");
  try {
    await extractZipSafe(archive, root, context.signal);
  } catch (error) {
    await fsp.rm(archive, { force: true });
    throw error;
  }
  await fsp.rm(downloadDir, { recursive: true, force: true });
  await context.report("installing", 82, "Installing a private Eclipse Temurin Java 25 runtime");
  await ensureJava(server.id, 25, context);
}

type InstallationProvider = {
  label: string;
  install: (server: Server, root: string, context: InstallContext) => Promise<void>;
};

const INSTALLATION_PROVIDERS = {
  mojang: { label: "Mojang", install: installMojang },
  fabric: { label: "Fabric", install: installFabric },
  bedrock: { label: "Minecraft Bedrock", install: installBedrock },
  steamcmd: { label: "SteamCMD", install: installSteam },
  hytale: { label: "Official Hytale Downloader", install: installHytale },
  manual: {
    label: "Manual",
    install: async (server: Server, _root: string, context: InstallContext) => {
      if (!server.launchCommand.trim()) throw new Error("A launch command is required for a manual server.");
      await context.report("installing", 75, "Manual server registered; program files will not be modified");
    },
  },
} satisfies Record<InstallerKind, InstallationProvider>;

export async function portAvailable(port: number, protocol: "TCP" | "UDP", address = "0.0.0.0") {
  if (protocol === "TCP") {
    return new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.unref();
      probe.once("error", () => resolve(false));
      probe.listen(port, address, () => probe.close(() => resolve(true)));
    });
  }
  return new Promise<boolean>((resolve) => {
    const probe = dgram.createSocket("udp4");
    probe.unref();
    probe.once("error", () => {
      try { probe.close(); } catch { /* socket never bound */ }
      resolve(false);
    });
    probe.bind(port, address, () => probe.close(() => resolve(true)));
  });
}

async function preflightInstallation(server: Server, root: string, context: InstallContext) {
  const game = getGame(server.gameId);
  await context.report("preflight", 3, "Checking storage, port and installation paths");
  throwIfCancelled(context.signal);
  await fsp.mkdir(path.dirname(root), { recursive: true });

  if (game.installer !== "manual" && process.env.SERVERHUB_SKIP_DISK_PREFLIGHT !== "1") {
    const stat = await fsp.statfs(path.dirname(root));
    const available = Number(stat.bavail) * Number(stat.bsize);
    const requiredMb = Math.ceil(game.installSizeMb * 1.15 + 256);
    const required = requiredMb * 1024 * 1024;
    if (available < required) {
      throw new Error(
        `Not enough disk space. ${game.name} needs approximately ${(requiredMb / 1024).toFixed(1)} GB, but only ${(available / 1024 / 1024 / 1024).toFixed(1)} GB is available.`
      );
    }
    await addInstallationEvent(
      context.jobId,
      server.id,
      "info",
      "preflight",
      5,
      `Storage check passed: ${(available / 1024 / 1024 / 1024).toFixed(1)} GB available.`
    );
  }

  if (!(await portAvailable(server.port, game.protocol, server.bindAddress))) {
    throw new Error(`Port ${server.port}/${game.protocol} is currently in use. Free the port or choose another one before retrying.`);
  }
  await context.report("preflight", 8, `Preflight checks passed for ${game.name}`);
}

async function validateInstalledArtifacts(server: Server, root: string) {
  const platform = process.platform;
  if (server.gameId === "minecraft" || server.gameId === "minecraft-modded") {
    if (!fs.existsSync(path.join(root, "server.jar"))) throw new Error("The downloaded server.jar is missing.");
    return;
  }
  if (server.gameId === "minecraft-bedrock") {
    const expected = path.join(root, platform === "win32" ? "bedrock_server.exe" : "bedrock_server");
    if (!fs.existsSync(expected)) throw new Error("The Bedrock server executable is missing from the official archive.");
    return;
  }
  const candidates: Record<string, string[]> = {
    valheim: platform === "win32" ? ["valheim_server.exe"] : ["valheim_server.x86_64"],
    ark: platform === "win32"
      ? ["ShooterGame/Binaries/Win64/ShooterGameServer.exe", "ShooterGameServer.exe"]
      : ["ShooterGame/Binaries/Linux/ShooterGameServer", "ShooterGameServer"],
    terraria: platform === "win32" ? ["TerrariaServer.exe"] : ["TerrariaServer.bin.x86_64", "TerrariaServer"],
    rust: platform === "win32" ? ["RustDedicated.exe"] : ["RustDedicated"],
    dragonwilds: platform === "win32"
      ? ["RSDragonwilds.exe", "RSDragonwildsServer.exe"]
      : ["RSDragonwildsServer.sh", "RSDragonwildsServer"],
  };
  if (server.gameId === "hytale") {
    if (!fs.existsSync(path.join(root, "Server", "HytaleServer.jar"))) throw new Error("HytaleServer.jar is missing from the official server archive.");
    if (!fs.existsSync(path.join(root, "Assets.zip"))) throw new Error("Assets.zip is missing from the official server archive.");
    return;
  }
  const expected = candidates[server.gameId];
  if (expected && !(await findExecutable(root, expected))) {
    throw new Error(`${getGame(server.gameId).name} installation completed, but its dedicated-server executable was not found.`);
  }
  if (getGame(server.gameId).installer === "manual" && !server.launchCommand.trim()) {
    throw new Error("A launch command is required for a manual server.");
  }
}

async function activateStaging(root: string, staging: string, jobId: number) {
  const previous = `${root}.serverhub-previous-${jobId}`;
  await fsp.rm(previous, { recursive: true, force: true });
  const hasCurrent = await fsp.stat(root).then(() => true).catch(() => false);
  if (hasCurrent) await fsp.rename(root, previous);
  try {
    await fsp.rename(staging, root);
  } catch (error) {
    if (hasCurrent) await fsp.rename(previous, root).catch(() => {});
    throw error;
  }
  if (hasCurrent) await fsp.rm(previous, { recursive: true, force: true });
}

async function executeInstallation(job: InstallationJob, server: Server, signal: AbortSignal) {
  const root = serverDir(server);
  const staged = server.managedDirectory ? `${root}.serverhub-install-${job.id}` : root;
  const context: InstallContext = {
    jobId: job.id,
    serverId: server.id,
    signal,
    report: async (phase, progress, message, level = "info") => reportInstallation(context, phase, progress, message, level),
    transfer: async (progress, bytesDone, bytesTotal, message) => updateTransfer(context, progress, bytesDone, bytesTotal, message),
  };

  try {
    await setStatus(server.id, "installing");
    await preflightInstallation(server, staged, context);
    await context.report("preparing", 10, `Preparing a recoverable staging area for ${server.name}`);
    await fsp.mkdir(staged, { recursive: true });
    if (job.kind === "update" && server.managedDirectory && fs.existsSync(root)) {
      await context.report("preparing", 12, "Copying the current installation so worlds can be preserved during the update");
      await fsp.cp(root, staged, {
        recursive: true,
        force: false,
        errorOnExist: false,
        preserveTimestamps: true,
        filter: () => {
          throwIfCancelled(signal);
          return true;
        },
      });
    }
    throwIfCancelled(signal);

    const game = getGame(server.gameId);
    const provider = INSTALLATION_PROVIDERS[game.installer];
    await addInstallationEvent(job.id, server.id, "info", "preparing", 10, `Using the ${provider.label} installation provider.`);
    await provider.install(server, staged, context);

    throwIfCancelled(signal);
    await context.report("validating", 84, "Validating installed dedicated-server files");
    await validateInstalledArtifacts(server, staged);
    await context.report("configuring", 90, "Writing managed server configuration");
    await writeServerConfig(server, staged, root);
    throwIfCancelled(signal);

    if (server.managedDirectory) {
      await context.report("activating", 96, "Activating the validated installation");
      await activateStaging(root, staged, job.id);
    }

    await db
      .update(installationJobs)
      .set({
        status: "succeeded",
        phase: "completed",
        progress: 100,
        message: "Installation complete",
        error: "",
        cancelRequested: false,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(installationJobs.id, job.id));
    await addInstallationEvent(job.id, server.id, "success", "completed", 100, `${server.name} is ready to start.`);
    await setStatus(server.id, "offline");
    await logLine(server.id, "success", "Installer", `Installation complete. ${server.name} is ready to start.`);
    await act(server.id, "server", `${server.name} installed successfully`);
  } catch (error) {
    const cancelled = error instanceof InstallationCancelledError || signal.aborted;
    const message = cleanInstallMessage(error instanceof Error ? error.message : String(error));
    if (cancelled && state.closing) {
      await db
        .update(installationJobs)
        .set({
          status: "queued",
          phase: "queued",
          message: "Installation paused while Server Hub shuts down",
          cancelRequested: false,
          updatedAt: new Date(),
          startedAt: null,
        })
        .where(eq(installationJobs.id, job.id));
      await addInstallationEvent(job.id, server.id, "warn", "queued", job.progress, "Installation paused and will recover on the next launch.");
      return;
    }

    await db
      .update(installationJobs)
      .set({
        status: cancelled ? "cancelled" : "failed",
        phase: cancelled ? "cancelled" : "failed",
        message: cancelled ? "Installation cancelled" : "Installation failed",
        error: cancelled ? "" : message,
        cancelRequested: cancelled,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(installationJobs.id, job.id));
    await addInstallationEvent(job.id, server.id, cancelled ? "warn" : "error", cancelled ? "cancelled" : "failed", job.progress, message);
    await setStatus(server.id, "error");
    await logLine(server.id, cancelled ? "warn" : "error", "Installer", message);
    await act(server.id, "server", `${server.name} installation ${cancelled ? "cancelled" : `failed: ${message}`}`);
    if (cancelled && server.managedDirectory) await fsp.rm(staged, { recursive: true, force: true }).catch(() => {});
  }
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

export async function writeServerConfig(storedServer: Server, rootOverride?: string, activatedRootOverride?: string) {
  const server = { ...storedServer, serverPassword: await revealSecret(storedServer.serverPassword), adminPassword: await revealSecret(storedServer.adminPassword), ownerId: await revealSecret(storedServer.ownerId) };
  const root = rootOverride ?? serverDir(server);
  const activatedRoot = activatedRootOverride ?? root;
  await fsp.mkdir(root, { recursive: true });
  if (server.gameId === "minecraft" || server.gameId === "minecraft-modded") {
    if (!server.eulaAccepted) throw new Error("The Minecraft EULA must be accepted before installation.");
    await fsp.writeFile(path.join(root, "eula.txt"), "# Accepted explicitly during Server Hub setup\neula=true\n", "utf8");
    await mergeProperties(path.join(root, "server.properties"), {
      motd: server.motd,
      "server-port": server.port,
      "server-ip": server.bindAddress,
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
      "server-ip": server.bindAddress,
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
      `world=${path.join(activatedRoot, "Worlds", `${safeFileName(server.worldName, "world")}.wld`)}`,
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
  } else if (server.gameId === "dragonwilds") {
    const clean = (value: string) => value.replace(/[\r\n]/g, " ").trim();
    if (!clean(server.ownerId)) throw new Error("Dragonwilds requires the owner's in-game Player ID.");
    if (clean(server.adminPassword).length < 5) throw new Error("Dragonwilds requires an admin password of at least five characters.");
    const platformFolder = process.platform === "win32" ? "WindowsServer" : "LinuxServer";
    const configFile = path.join(root, "RSDragonwilds", "Saved", "Config", platformFolder, "DedicatedServer.ini");
    const config = [
      "[SectionsToSave]",
      "bCanSaveAllSections=true",
      "",
      "[/Script/Dominion.DedicatedServerSettings]",
      `OwnerId=${clean(server.ownerId)}`,
      `ServerName=${clean(server.name).slice(0, 16)}`,
      `DefaultWorldName=${clean(server.worldName).slice(0, 16)}`,
      `AdminPassword=${clean(server.adminPassword)}`,
      `WorldPassword=${clean(server.serverPassword)}`,
      "",
    ].join("\n");
    await fsp.mkdir(path.dirname(configFile), { recursive: true });
    await fsp.writeFile(configFile, config, { encoding: "utf8", mode: 0o600 });
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
  for (const candidate of candidates) {
    const direct = path.resolve(root, candidate);
    const prefix = `${path.resolve(root)}${path.sep}`;
    if (direct.startsWith(prefix) && await fsp.stat(direct).then((stat) => stat.isFile()).catch(() => false)) return direct;
  }
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

async function ensureJava(serverId: number, major: number, context?: InstallContext): Promise<string> {
  const override = process.env[`SERVERHUB_JAVA_PATH_${major}`];
  if (override && fs.existsSync(override)) return path.resolve(override);
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
  await downloadFile(url, archive, serverId, `Eclipse Temurin Java ${major} runtime`, context, context ? [82, 89] : [20, 75]);
  await fsp.rm(javaRoot, { recursive: true, force: true });
  await fsp.mkdir(javaRoot, { recursive: true });
  try {
    if (ext === "zip") await extractZipSafe(archive, javaRoot, context?.signal);
    else await extractTarGz(archive, javaRoot);
  } catch (error) {
    await fsp.rm(archive, { force: true });
    await fsp.rm(javaRoot, { recursive: true, force: true });
    throw error;
  }
  await fsp.rm(archive, { force: true });
  const java = await findExecutable(javaRoot, [executableName, `bin/${executableName}`]);
  if (!java) throw new Error("Java runtime archive did not contain a java executable.");
  if (process.platform !== "win32") await fsp.chmod(java, 0o755).catch(() => {});
  return java;
}

type LaunchSpec = { executable: string; args: string[]; env?: Record<string, string | undefined>; cwd?: string };

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
      args: ["-nographics", "-batchmode", "-name", server.name, "-port", String(server.port), "-world", server.worldName, "-password", server.serverPassword, "-public", "1", "-ip", server.bindAddress],
      env: process.platform === "linux" ? { LD_LIBRARY_PATH: `${path.dirname(executable)}/linux64:${process.env.LD_LIBRARY_PATH || ""}` } : undefined,
    };
  }
  if (server.gameId === "ark") {
    const executable = await findExecutable(root, process.platform === "win32"
      ? ["ShooterGame/Binaries/Win64/ShooterGameServer.exe", "ShooterGameServer.exe"]
      : ["ShooterGame/Binaries/Linux/ShooterGameServer", "ShooterGameServer"]);
    if (!executable) throw new Error("ARK server executable was not found after SteamCMD installation.");
    const map = server.worldName || "TheIsland";
    return { executable, args: [`${map}?SessionName=${server.name}?Port=${server.port}?QueryPort=${getGame(server.gameId).queryPort ?? 27015}?MaxPlayers=${server.maxPlayers}?MultiHome=${server.bindAddress}`, "-server", "-log"] };
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
      "+server.hostname", server.name, "+server.ip", server.bindAddress, "+server.port", String(server.port),
      "+server.queryport", String(getGame(server.gameId).queryPort ?? server.port + 1),
      "+server.maxplayers", String(server.maxPlayers), "+server.seed", server.seed || "0",
      "+server.description", server.motd,
    ] };
  }
  if (server.gameId === "dragonwilds") {
    const executable = await findExecutable(root, process.platform === "win32"
      ? ["RSDragonwilds.exe", "RSDragonwildsServer.exe"]
      : ["RSDragonwildsServer.sh", "RSDragonwildsServer"]);
    if (!executable) throw new Error("The Dragonwilds dedicated-server executable was not found after SteamCMD installation.");
    if (!server.ownerId.trim()) throw new Error("Dragonwilds requires the owner's in-game Player ID.");
    if (server.adminPassword.length < 5) throw new Error("Dragonwilds requires an admin password of at least five characters.");
    if (process.platform !== "win32") await fsp.chmod(executable, 0o755).catch(() => {});
    return { executable, args: ["-log", "-NewConsole", `-Port=${server.port}`, `-MULTIHOME=${server.bindAddress}`] };
  }
  if (server.gameId === "hytale") {
    const serverRoot = path.join(root, "Server");
    const jar = path.join(serverRoot, "HytaleServer.jar");
    const assets = path.join(root, "Assets.zip");
    if (!fs.existsSync(jar) || !fs.existsSync(assets)) throw new Error("Hytale server artifacts are missing. Retry installation first.");
    const java = await ensureJava(server.id, 25);
    const aot = fs.existsSync(path.join(serverRoot, "HytaleServer.aot")) ? ["-XX:AOTCache=HytaleServer.aot"] : [];
    return {
      executable: java,
      cwd: serverRoot,
      args: [
        `-Xms${Math.min(2048, server.memoryMb)}M`,
        `-Xmx${server.memoryMb}M`,
        ...aot,
        "-jar", "HytaleServer.jar",
        "--assets", "../Assets.zip",
        "--bind", `${server.bindAddress}:${server.port}`,
      ],
    };
  }
  throw new Error("This manual server needs a launch command in Settings.");
}

// ---------------------------------------------------------------------------
// Real process lifecycle and metrics
// ---------------------------------------------------------------------------

async function reconcileA2sPlayerSessions(server:Server,observed:Awaited<ReturnType<typeof queryA2sPlayers>>){
 const provider="steam-a2s",now=new Date(),open=await db.select().from(playerSessions).where(and(eq(playerSessions.serverId,server.id),eq(playerSessions.provider,provider),isNull(playerSessions.leftAt))); const byKey=new Map(observed.filter(item=>item.name.trim()).map(item=>[observationKey(provider,item.name),item])); const changes=reconcileObservationKeys(open.map(item=>item.observationKey),[...byKey.keys()]);
 for(const key of changes.left){const session=open.find(item=>item.observationKey===key);if(session)await db.update(playerSessions).set({leftAt:now,durationSec:Math.max(session.durationSec,Math.round((now.getTime()-(session.joinedAt?.getTime()??now.getTime()))/1000))}).where(eq(playerSessions.id,session.id));}
 for(const key of changes.joined){const item=byKey.get(key);if(item)await db.insert(playerSessions).values({serverId:server.id,provider,observationKey:key,displayName:item.name.slice(0,100),joinedAt:new Date(now.getTime()-Math.max(0,item.durationSeconds)*1000),durationSec:Math.round(Math.max(0,item.durationSeconds)),score:item.score});}
 const known=await db.select().from(players).where(eq(players.serverId,server.id)); for(const row of known.filter(row=>row.externalId.startsWith(`${provider}:`)&&!changes.online.includes(row.externalId)))await db.update(players).set({isOnline:false,lastSeen:now}).where(eq(players.id,row.id)); for(const [key,item] of byKey){const row=known.find(value=>value.externalId===key);if(row)await db.update(players).set({name:item.name.slice(0,100),isOnline:true,ping:0,lastSeen:now}).where(eq(players.id,row.id));else await db.insert(players).values({serverId:server.id,name:item.name.slice(0,100),externalId:key,isOnline:true,lastSeen:now});}
}
async function probeEntry(entry:RuntimeEntry){
 const server=entry.server,game=getGame(server.gameId); const method=server.gameId.startsWith("minecraft")?"minecraft-status":["ark","rust","valheim"].includes(server.gameId)?"steam-a2s":game.protocol==="UDP"?"process-stability":"tcp-connect";
 let detail="",metadata:Record<string,unknown>|null=null; const ok=method==="minecraft-status"?await queryMinecraftStatus(server.bindAddress,server.port).then(info=>{metadata={provider:"minecraft",version:info.version,protocol:info.protocol,motd:info.motd,players:info.players,maxPlayers:info.maxPlayers,latencyMs:info.latencyMs};detail=`${info.version} · ${info.players}/${info.maxPlayers} players · ${info.latencyMs} ms${info.motd?` · ${info.motd}`:""}`;return true}).catch(()=>false):method==="steam-a2s"?await queryA2sInfo(server.bindAddress,game.queryPort!).then(async info=>{const observed=await queryA2sPlayers(server.bindAddress,game.queryPort!).catch(()=>null);if(observed)await reconcileA2sPlayerSessions(server,observed);metadata={provider:"steam-a2s",name:info.name,map:info.map,game:info.game,players:info.players,maxPlayers:info.maxPlayers,bots:info.bots,password:info.password,vac:info.vac,version:info.version};detail=`${info.name} · ${info.map} · ${info.players}/${info.maxPlayers} players · v${info.version}`;return true}).catch(()=>false):method==="process-stability"?state.processes.has(server.id):await new Promise<boolean>(resolve=>{const socket=net.createConnection({host:server.bindAddress,port:server.port});const done=(v:boolean)=>{socket.destroy();resolve(v)};socket.setTimeout(750);socket.once("connect",()=>done(true));socket.once("timeout",()=>done(false));socket.once("error",()=>done(false))});
 if(ok&&metadata)await db.update(servers).set({queryMetadata:JSON.stringify(metadata),lastQueryAt:new Date()}).where(eq(servers.id,server.id));
 return {ok,method,detail};
}
async function waitUntilReady(entry: RuntimeEntry) {
 const deadline=Date.now()+Math.max(10,Math.min(300,entry.server.readinessTimeoutSec))*1000;
 while(Date.now()<deadline&&state.processes.has(entry.server.id)){if((await probeEntry(entry)).ok)return true;await new Promise(resolve=>setTimeout(resolve,500));} return false;
}

export async function startFlow(id: number, automatic = false): Promise<{ ok: boolean; reason?: string }> {
  await ensureRuntimeInitialized();
  const pendingRestart = state.restartTimers.get(id);
  if (pendingRestart) {
    clearTimeout(pendingRestart);
    state.restartTimers.delete(id);
  }
  if (!automatic) state.crashHistory.delete(id);
  const [server] = await db.select().from(servers).where(eq(servers.id, id));
  if (!server) return { ok: false, reason: "Server not found" };
  if (state.processes.has(id)) return { ok: false, reason: "Server process is already running" };
  if (state.installs.has(id) || server.status === "installing") return { ok: false, reason: "Installation is still running" };
  if (server.status === "error") return { ok: false, reason: "Installation failed. Retry installation first." };

  try {
    const game = getGame(server.gameId);
    if (!(await portAvailable(server.port, game.protocol, server.bindAddress))) {
      throw new Error(`Port ${server.port}/${game.protocol} is currently in use. Stop the conflicting process or choose another port.`);
    }
    await writeServerConfig(server);
    await setStatus(id, "starting");
    await logLine(id, "system", "Runtime", `Starting ${server.name} from ${serverDir(server)}`);
    const spec = await launchSpec(server);
    const env = { ...process.env, ...spec.env };
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd ?? serverDir(server),
      env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const entry: RuntimeEntry = {
      child,
      server,
      metrics: [],
      monitor: undefined as unknown as NodeJS.Timeout,
      stopping: false,
      restarting: false,
      lineCount: 0,
      startedAtMs: Date.now(),
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

    const probe=server.gameId.startsWith("minecraft")?"minecraft-status":["ark","rust","valheim"].includes(server.gameId)?"steam-a2s":getGame(server.gameId).protocol==="UDP"?"process-stability":"tcp-connect";
    await db.update(servers).set({healthStatus:"checking",healthReason:"Waiting for provider readiness",healthProbe:probe,updatedAt:new Date()}).where(eq(servers.id,id));
    const ready = await waitUntilReady(entry);
    if (!state.processes.has(id)) { await setHealth(id,"blocked","Process exited during startup",probe,false); await incident(id,"error","readiness","Process exited during startup","Review Console and run Diagnostics"); return { ok: false, reason: "The server process exited during startup. Check Console for details." }; }
    if (!ready) { await setHealth(id,"blocked",`Readiness timed out after ${server.readinessTimeoutSec} seconds`,probe,false); await incident(id,"error","readiness","Provider readiness timed out","Review bind address, ports, firewall, and provider logs");
      entry.stopping = true;
      killProcessTree(child.pid, true);
      throw new Error(`Readiness probe timed out after ${server.readinessTimeoutSec} seconds on ${server.bindAddress}:${server.port}.`);
    }
    await db.update(servers).set({ status: "online", lastStartedAt: new Date(), updatedAt: new Date() }).where(eq(servers.id, id));
    await setHealth(id,"ready","Provider readiness probe passed",probe,true);
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
  if (entry.restarting && !state.closing) {
    setTimeout(() => void startFlow(id), 900);
  } else if (!expected && !state.closing) {
    await scheduleCrashRestart(entry);
  }
}

async function scheduleCrashRestart(entry: RuntimeEntry) {
  // Read the latest settings so disabling the watchdog (or changing its limit)
  // while a server is running takes effect on that process's next exit.
  const [server] = await db.select().from(servers).where(eq(servers.id, entry.server.id));
  if (!server?.autoRestart) return;
  const id = server.id;
  const now = Date.now();
  const windowMs = Math.max(30, Math.min(3600, server.restartWindowSec)) * 1000;
  let history = (state.crashHistory.get(id) ?? []).filter((timestamp) => now - timestamp <= windowMs);
  if (now - entry.startedAtMs >= windowMs) history = [];
  history.push(now);
  state.crashHistory.set(id, history);
  const limit = Math.max(0, Math.min(20, server.maxCrashRestarts));
  if (history.length > limit) {
    await setStatus(id, "crashed");
    await logLine(id, "error", "Watchdog", `Automatic restart limit reached (${limit} within ${Math.round(windowMs / 1000)} seconds). Manual intervention is required.`);
    await act(id, "power", `${server.name} restart limit reached`);
    return;
  }

  const delaySeconds = Math.min(30, 2 ** (history.length - 1) * 2);
  await setStatus(id, "restarting");
  await logLine(id, "warn", "Watchdog", `Unexpected exit detected. Automatic restart ${history.length} of ${limit} begins in ${delaySeconds} seconds.`);
  await act(id, "power", `${server.name} scheduled for automatic restart`);
  const timer = setTimeout(() => {
    if (state.restartTimers.get(id) !== timer) return;
    state.restartTimers.delete(id);
    void (async () => {
      const [latest] = await db.select().from(servers).where(eq(servers.id, id));
      if (!latest?.autoRestart) {
        state.crashHistory.delete(id);
        if (latest) await setStatus(id, "offline");
        return;
      }
      const result = await startFlow(id, true);
      if (!result.ok) await logLine(id, "error", "Watchdog", `Automatic restart failed: ${result.reason ?? "unknown error"}`);
    })();
  }, delaySeconds * 1000);
  timer.unref?.();
  state.restartTimers.set(id, timer);
}

function stopCommand(server: Server): string {
  if (server.gameId === "minecraft" || server.gameId === "minecraft-modded" || server.gameId === "minecraft-bedrock") return "stop";
  if (server.gameId === "terraria") return "exit";
  if (server.gameId === "rust") return "quit";
  if (server.gameId === "ark") return "DoExit";
  if (server.gameId === "hytale") return "/stop";
  return "stop";
}

export async function cancelPendingRestart(id: number, reason = "Panel") {
  await ensureRuntimeInitialized();
  const pendingRestart = state.restartTimers.get(id);
  if (!pendingRestart) return false;
  clearTimeout(pendingRestart);
  state.restartTimers.delete(id);
  state.crashHistory.delete(id);
  await setStatus(id, "offline");
  await logLine(id, "system", "Watchdog", `Pending automatic restart cancelled by ${reason}.`);
  return true;
}

export async function stopFlow(id: number, reason = "Panel"): Promise<{ ok: boolean; reason?: string }> {
  await ensureRuntimeInitialized();
  if (await cancelPendingRestart(id, reason)) return { ok: true };
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
  const pendingRestart = state.restartTimers.get(id);
  if (pendingRestart) {
    clearTimeout(pendingRestart);
    state.restartTimers.delete(id);
    state.crashHistory.delete(id);
  }
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

export async function createBackupAndWait(id: number, label?: string, by = "you", timeoutMs = 30 * 60_000) {
  const created = await createBackup(id, label, by);
  if (!created) throw new Error("Server not found");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [current] = await db.select().from(backups).where(eq(backups.id, created.id));
    if (!current) throw new Error("Backup record disappeared");
    if (current.status === "complete") return current;
    if (current.status === "failed") throw new Error(current.note || "Backup failed");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Safety backup timed out");
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

async function enforceExpiredModeration(){const now=new Date(),pending=await db.select().from(moderationActions).where(and(eq(moderationActions.status,"pending-expiration"),lte(moderationActions.expiresAt,now)));for(const record of pending){if(record.expirationAttempts>=3){await db.update(moderationActions).set({status:"expiration-failed"}).where(eq(moderationActions.id,record.id));continue}const [server]=await db.select().from(servers).where(eq(servers.id,record.serverId));const [player]=await db.select().from(players).where(eq(players.id,record.playerId));if(!server||!player){await db.update(moderationActions).set({status:"expiration-failed"}).where(eq(moderationActions.id,record.id));continue}const command=`pardon ${record.target}`,result=await runCommand(server,command);const attempts=record.expirationAttempts+1;await db.update(moderationActions).set({expirationAttempts:attempts,lastExpirationAttemptAt:now,status:result.ok?"expiration-enforced":attempts>=3?"expiration-failed":"pending-expiration"}).where(eq(moderationActions.id,record.id));await db.insert(moderationActions).values({serverId:server.id,playerId:player.id,action:"automatic-unban",target:record.target,command,reason:`Temporary ban #${record.id} expired`,status:result.ok?"sent":"failed"});if(result.ok)await db.update(players).set({isBanned:false}).where(eq(players.id,player.id));}}

export async function sweepTasks(serverId?: number) {
  await ensureRuntimeInitialized();
  if (state.sweeping) return;
  state.sweeping = true;
  try {
    await enforceExpiredModeration();
    const now = new Date();
    const enabled = await db.select().from(tasks).where(eq(tasks.enabled, true));
    for (const task of enabled) {
      if (serverId && task.serverId !== serverId) continue;
      if (!task.nextRunAt || task.nextRunAt > now) continue;
      await db.update(tasks).set({ lastRunAt: now, nextRunAt: new Date(now.getTime() + Math.max(1, task.intervalMin) * 60_000) }).where(eq(tasks.id, task.id));
      const [server] = await db.select().from(servers).where(eq(servers.id, task.serverId));
      if (!server) continue;
      if (task.type === "backup") await createBackup(server.id, `auto-${safeFileName(task.name)}`, "scheduler");
      else if (task.type === "maintenance") {
        await logLine(server.id, "system", "Maintenance", `Scheduled maintenance "${task.name}" started.`);
        if (state.processes.has(server.id)) { await runCommand(server, "say Scheduled maintenance is starting", "Scheduler"); await stopFlow(server.id, "Maintenance"); await new Promise((resolve) => setTimeout(resolve, 2000)); }
        const safety = await createBackupAndWait(server.id, `maintenance-${safeFileName(task.name)}`, "scheduler");
        const installed = await installFlow(server.id);
        if (!installed.ok || !installed.jobId) await logLine(server.id, "error", "Maintenance", `Update queue failed: ${installed.reason}`);
        else {
          const deadline = Date.now() + 2 * 60 * 60_000;
          let outcome = "running";
          while (Date.now() < deadline && ["queued","running","cancelling"].includes(outcome)) { await new Promise((resolve)=>setTimeout(resolve,1000)); const [job]=await db.select().from(installationJobs).where(eq(installationJobs.id,installed.jobId!)); outcome=job?.status ?? "failed"; }
          if (outcome === "succeeded") {
            const started = await startFlow(server.id);
            if (!started.ok) { await logLine(server.id,"error","Maintenance",`Readiness failed; restoring safety backup: ${started.reason}`); await restoreBackup(server.id,safety.id); await startFlow(server.id); }
            else await logLine(server.id,"success","Maintenance",`Scheduled maintenance "${task.name}" completed and readiness passed.`);
          } else await logLine(server.id,"error","Maintenance",`Update ended with status ${outcome}.`);
        }
      }
      else if (task.type === "restart") {
        if (state.processes.has(server.id)) await restartFlow(server.id);
        else await logLine(server.id, "warn", "Scheduler", `Skipped "${task.name}": server is offline.`);
      } else if (task.type === "broadcast") await runCommand(server, `say ${task.payload}`, "Scheduler");
      else if (task.type === "command") await runCommand(server, task.payload, "Scheduler");
      await act(server.id, "task", `Scheduled task "${task.name}" executed`);
    }
    for (const entry of state.processes.values()) {
      if (serverId && entry.server.id !== serverId) continue;
      const result=await probeEntry(entry).catch(()=>({ok:false,method:"probe-error",detail:""}));
      if(result.ok) await setHealth(entry.server.id,"ready",result.detail||"Recurring provider health probe passed",result.method,true);
      else { const failures=await setHealth(entry.server.id,"degraded","Provider health probe failed",result.method,false); if(failures===3) await incident(entry.server.id,"warning","health","Server became degraded after three consecutive probe failures","Review Diagnostics, firewall, and provider output"); }
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
