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
  bindAddress: text("bind_address").notNull().default("192.168.1.210"),
  publicAddress: text("public_address").notNull().default("185.83.148.20"),
  readinessTimeoutSec: integer("readiness_timeout_sec").notNull().default(60),
  healthStatus: text("health_status").notNull().default("unknown"),
  healthReason: text("health_reason").notNull().default(""),
  healthProbe: text("health_probe").notNull().default("none"),
  healthFailures: integer("health_failures").notNull().default(0),
  lastHealthSuccessAt: ts("last_health_success_at"),
  lastHealthFailureAt: ts("last_health_failure_at"),
  queryMetadata: text("query_metadata").notNull().default(""),
  lastQueryAt: ts("last_query_at"),
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

export const serverTemplates = sqliteTable("server_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), gameId: text("game_id").notNull(), config: text("config").notNull(), createdAt: tsNow("created_at"), updatedAt: tsNow("updated_at"),
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
    trusted: integer("trusted", { mode: "boolean" }).notNull().default(false),
    notes: text("notes").notNull().default(""),
    firstSeen: tsNow("first_seen"),
    lastSeen: tsNow("last_seen"),
  },
  (t) => [index("players_server_idx").on(t.serverId)]
);

export const toolJobs = sqliteTable("tool_jobs", { id: integer("id").primaryKey({autoIncrement:true}), toolId: text("tool_id").notNull(), operation: text("operation").notNull(), status: text("status").notNull(), progress: integer("progress").notNull().default(0), message: text("message").notNull().default(""), error: text("error").notNull().default(""), rollbackAvailable: integer("rollback_available",{mode:"boolean"}).notNull().default(false), createdAt: tsNow("created_at"), updatedAt: tsNow("updated_at"), completedAt: ts("completed_at") },t=>[index("tool_jobs_status_idx").on(t.toolId,t.status)]);

export const toolInventory = sqliteTable("tool_inventory", { id: text("id").primaryKey(), name: text("name").notNull(), ownership: text("ownership").notNull(), pathCategory: text("path_category").notNull(), available: integer("available", { mode: "boolean" }).notNull().default(false), detectedVersion: text("detected_version").notNull().default(""), expectedVersion: text("expected_version").notNull().default(""), integrityStatus: text("integrity_status").notNull().default("unknown"), lastVerifiedAt: ts("last_verified_at"), lastUsedAt: ts("last_used_at"), lastError: text("last_error").notNull().default(""), updateStatus: text("update_status").notNull().default("unchecked"), availableVersion: text("available_version").notNull().default(""), updateSource: text("update_source").notNull().default(""), lastUpdateCheckAt: ts("last_update_check_at"), fingerprintSha256: text("fingerprint_sha256").notNull().default(""), fingerprintSize: integer("fingerprint_size").notNull().default(0), signatureStatus: text("signature_status").notNull().default("unchecked"), signaturePublisher: text("signature_publisher").notNull().default(""), signatureThumbprint: text("signature_thumbprint").notNull().default(""), signatureVerifiedAt: ts("signature_verified_at"), updatedAt: tsNow("updated_at") });
export const toolOperations = sqliteTable("tool_operations", { id: integer("id").primaryKey({autoIncrement:true}), toolId: text("tool_id").notNull(), operation: text("operation").notNull(), status: text("status").notNull(), summary: text("summary").notNull().default(""), versionBefore: text("version_before").notNull().default(""), versionAfter: text("version_after").notNull().default(""), startedAt: tsNow("started_at"), completedAt: ts("completed_at") }, t=>[index("tool_operations_tool_idx").on(t.toolId,t.startedAt)]);

export const taskRuns = sqliteTable("task_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }), retryOfRunId: integer("retry_of_run_id"), taskId: integer("task_id").notNull(), serverId: integer("server_id").notNull(), taskName: text("task_name").notNull(), type: text("type").notNull(), command: text("command").notNull().default(""), status: text("status").notNull(), error: text("error").notNull().default(""), createdAt: tsNow("created_at"),
}, (t) => [index("task_runs_server_idx").on(t.serverId, t.createdAt)]);

export const moderationActions = sqliteTable("moderation_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }), serverId: integer("server_id").notNull(), playerId: integer("player_id").notNull(), action: text("action").notNull(), target: text("target").notNull(), command: text("command").notNull(), reason: text("reason").notNull().default(""), status: text("status").notNull(), expirationAttempts: integer("expiration_attempts").notNull().default(0), lastExpirationAttemptAt: ts("last_expiration_attempt_at"), expiresAt: ts("expires_at"), createdAt: tsNow("created_at"),
}, (t) => [index("moderation_actions_server_idx").on(t.serverId, t.createdAt)]);

export const playerSessions = sqliteTable("player_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }), serverId: integer("server_id").notNull(), provider: text("provider").notNull(), observationKey: text("observation_key").notNull(), displayName: text("display_name").notNull(), joinedAt: tsNow("joined_at"), leftAt: ts("left_at"), durationSec: integer("duration_sec").notNull().default(0), score: integer("score").notNull().default(0),
}, (t) => [index("player_sessions_server_idx").on(t.serverId, t.joinedAt)]);

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
    scheduleKind: text("schedule_kind").notNull().default("interval"),
    scheduleTime: text("schedule_time").notNull().default("09:00"),
    scheduleWeekday: integer("schedule_weekday").notNull().default(1),
    missedPolicy: text("missed_policy").notNull().default("run"),
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

export const incidents = sqliteTable("incidents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serverId: integer("server_id"),
  severity: text("severity").notNull().default("warning"),
  component: text("component").notNull(),
  summary: text("summary").notNull(),
  remediation: text("remediation").notNull().default(""),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  relatedType: text("related_type").notNull().default(""),
  relatedId: integer("related_id"),
  createdAt: tsNow("created_at"),
  resolvedAt: ts("resolved_at"),
}, (t) => [index("incidents_server_idx").on(t.serverId,t.id)]);

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

export type ServerTemplate = typeof serverTemplates.$inferSelect;
export type Server = typeof servers.$inferSelect;
export type ConsoleLog = typeof consoleLogs.$inferSelect;
export type ToolJob = typeof toolJobs.$inferSelect;
export type ToolInventory = typeof toolInventory.$inferSelect;
export type ToolOperation = typeof toolOperations.$inferSelect;
export type TaskRun = typeof taskRuns.$inferSelect;
export type ModerationActionRecord = typeof moderationActions.$inferSelect;
export type PlayerSession = typeof playerSessions.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Backup = typeof backups.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Addon = typeof addons.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type InstallationJob = typeof installationJobs.$inferSelect;
export type InstallationEvent = typeof installationEvents.$inferSelect;

export { sql };
