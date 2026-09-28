import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Server Hub schema — embedded SQLite (node:sqlite) so the panel runs as a
// single portable executable with no external database server.
// ---------------------------------------------------------------------------

const ts = (name: string) => integer(name, { mode: "timestamp" });
const tsNow = (name: string) => integer(name, { mode: "timestamp" }).$defaultFn(() => new Date());

export const servers = sqliteTable("servers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  gameId: text("game_id").notNull(),
  version: text("version").notNull(),
  loader: text("loader").notNull().default("vanilla"),
  status: text("status").notNull().default("installing"),
  port: integer("port").notNull(),
  bindAddress: text("bind_address").notNull().default("185.83.148.20"),
  readinessTimeoutSec: integer("readiness_timeout_sec").notNull().default(60),
  memoryMb: integer("memory_mb").notNull().default(4096),
  maxPlayers: integer("max_players").notNull().default(20),
  motd: text("motd").notNull().default(""),
  worldName: text("world_name").notNull().default("world"),
  seed: text("seed").notNull().default(""),
  difficulty: text("difficulty").notNull().default("normal"),
  pvp: integer("pvp", { mode: "boolean" }).notNull().default(true),
  launchCommand: text("launch_command").notNull().default(""),
  launchArgs: text("launch_args").notNull().default(""),
  workingDirectory: text("working_directory").notNull().default(""),
  autoRestart: integer("auto_restart", { mode: "boolean" }).notNull().default(false),
  maxCrashRestarts: integer("max_crash_restarts").notNull().default(3),
  restartWindowSec: integer("restart_window_sec").notNull().default(300),
  autoBackupBeforeUpdate: integer("auto_backup_before_update", { mode: "boolean" }).notNull().default(true),
  updateBackupRetention: integer("update_backup_retention").notNull().default(5),
  managedDirectory: integer("managed_directory", { mode: "boolean" }).notNull().default(true),
  serverPassword: text("server_password").notNull().default(""),
  adminPassword: text("admin_password").notNull().default(""),
  ownerId: text("owner_id").notNull().default(""),
  eulaAccepted: integer("eula_accepted", { mode: "boolean" }).notNull().default(false),
  createdAt: tsNow("created_at"),
  updatedAt: tsNow("updated_at"),
  lastStartedAt: ts("last_started_at"),
});

export const consoleLogs = sqliteTable(
  "console_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id").notNull(),
    ts: tsNow("ts"),
    level: text("level").notNull().default("info"),
    source: text("source").notNull().default("Server"),
    message: text("message").notNull(),
  },
  (t) => [index("logs_server_idx").on(t.serverId, t.id)]
);

export const players = sqliteTable(
  "players",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id").notNull(),
    name: text("name").notNull(),
    externalId: text("external_id").notNull(),
    isOnline: integer("is_online", { mode: "boolean" }).notNull().default(false),
    isOp: integer("is_op", { mode: "boolean" }).notNull().default(false),
    isBanned: integer("is_banned", { mode: "boolean" }).notNull().default(false),
    playMinutes: integer("play_minutes").notNull().default(0),
    ping: integer("ping").notNull().default(0),
    firstSeen: tsNow("first_seen"),
    lastSeen: tsNow("last_seen"),
  },
  (t) => [index("players_server_idx").on(t.serverId)]
);

export const backups = sqliteTable(
  "backups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id").notNull(),
    name: text("name").notNull(),
    sizeMb: integer("size_mb").notNull().default(0),
    status: text("status").notNull().default("complete"),
    note: text("note").notNull().default(""),
    archivePath: text("archive_path").notNull().default(""),
    checksum: text("checksum").notNull().default(""),
    createdAt: tsNow("created_at"),
  },
  (t) => [index("backups_server_idx").on(t.serverId)]
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    payload: text("payload").notNull().default(""),
    intervalMin: integer("interval_min").notNull().default(360),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    lastRunAt: ts("last_run_at"),
    nextRunAt: ts("next_run_at"),
    createdAt: tsNow("created_at"),
  },
  (t) => [index("tasks_server_idx").on(t.serverId)]
);

export const addons = sqliteTable(
  "addons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id").notNull(),
    name: text("name").notNull(),
    version: text("version").notNull().default("1.0.0"),
    author: text("author").notNull().default("unknown"),
    source: text("source").notNull().default("Modrinth"),
    summary: text("summary").notNull().default(""),
    downloads: integer("downloads").notNull().default(0),
    projectId: text("project_id").notNull().default(""),
    filePath: text("file_path").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    installedAt: tsNow("installed_at"),
  },
  (t) => [index("addons_server_idx").on(t.serverId)]
);

export const files = sqliteTable(
  "files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id").notNull(),
    path: text("path").notNull(),
    content: text("content").notNull(),
    updatedAt: tsNow("updated_at"),
  },
  (t) => [index("files_server_idx").on(t.serverId)]
);

export const activity = sqliteTable(
  "activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id"),
    kind: text("kind").notNull().default("server"),
    message: text("message").notNull(),
    ts: tsNow("ts"),
  },
  (t) => [index("activity_ts_idx").on(t.id)]
);

/**
 * Durable installer state. A job survives an application restart and can be
 * re-queued without losing a partially downloaded artifact in its staging
 * directory.
 */
export const installationJobs = sqliteTable(
  "installation_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: integer("server_id").notNull(),
    kind: text("kind").notNull().default("install"),
    status: text("status").notNull().default("queued"),
    phase: text("phase").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    bytesDone: integer("bytes_done").notNull().default(0),
    bytesTotal: integer("bytes_total").notNull().default(0),
    message: text("message").notNull().default("Waiting to install"),
    error: text("error").notNull().default(""),
    attempt: integer("attempt").notNull().default(1),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    createdAt: tsNow("created_at"),
    updatedAt: tsNow("updated_at"),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
  },
  (t) => [index("installation_jobs_server_idx").on(t.serverId, t.id)]
);

export const installationEvents = sqliteTable(
  "installation_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id").notNull(),
    serverId: integer("server_id").notNull(),
    level: text("level").notNull().default("info"),
    phase: text("phase").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    message: text("message").notNull(),
    createdAt: tsNow("created_at"),
  },
  (t) => [
    index("installation_events_job_idx").on(t.jobId, t.id),
    index("installation_events_server_idx").on(t.serverId, t.id),
  ]
);

export type Server = typeof servers.$inferSelect;
export type ConsoleLog = typeof consoleLogs.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Backup = typeof backups.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Addon = typeof addons.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type InstallationJob = typeof installationJobs.$inferSelect;
export type InstallationEvent = typeof installationEvents.$inferSelect;

export { sql };
