import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as schema from "./schema";

/**
 * Server Hub database — embedded SQLite via Node's built-in `node:sqlite`.
 * No external database server and no native modules to compile, so the panel
 * ships as a single portable executable on every platform.
 *
 * Drizzle's `better-sqlite3` entrypoint statically imports the native package,
 * so Next aliases it to `better-sqlite3-stub.ts` (see next.config.ts). We pass
 * our own adapted client, so the stub is never instantiated.
 */

export function resolveDbPath(): string {
  const override = process.env.SERVERHUB_DB;
  if (override) return override;

  if (process.versions.electron) {
    const appData = process.env.SERVERHUB_APPDATA ?? path.join(os.homedir(), ".serverhub");
    return path.join(appData, "serverhub.db");
  }
  return path.join(process.cwd(), "data", "serverhub.db");
}

export const dbPath = resolveDbPath();

/** DDL that bootstraps the database — no separate migration step required. */
const DDL = [
  `CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    game_id TEXT NOT NULL,
    version TEXT NOT NULL,
    loader TEXT NOT NULL DEFAULT 'vanilla',
    status TEXT NOT NULL DEFAULT 'installing',
    port INTEGER NOT NULL,
    bind_address TEXT NOT NULL DEFAULT '192.168.1.210',
    public_address TEXT NOT NULL DEFAULT '185.83.148.20',
    readiness_timeout_sec INTEGER NOT NULL DEFAULT 60,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    health_reason TEXT NOT NULL DEFAULT '',
    health_probe TEXT NOT NULL DEFAULT 'none',
    health_failures INTEGER NOT NULL DEFAULT 0,
    last_health_success_at INTEGER,
    last_health_failure_at INTEGER,
    query_metadata TEXT NOT NULL DEFAULT '',
    last_query_at INTEGER,
    memory_mb INTEGER NOT NULL DEFAULT 4096,
    max_players INTEGER NOT NULL DEFAULT 20,
    motd TEXT NOT NULL DEFAULT '',
    world_name TEXT NOT NULL DEFAULT 'world',
    seed TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL DEFAULT 'normal',
    pvp INTEGER NOT NULL DEFAULT 1,
    launch_command TEXT NOT NULL DEFAULT '',
    launch_args TEXT NOT NULL DEFAULT '',
    working_directory TEXT NOT NULL DEFAULT '',
    auto_restart INTEGER NOT NULL DEFAULT 0,
    max_crash_restarts INTEGER NOT NULL DEFAULT 3,
    restart_window_sec INTEGER NOT NULL DEFAULT 300,
    auto_backup_before_update INTEGER NOT NULL DEFAULT 1,
    update_backup_retention INTEGER NOT NULL DEFAULT 5,
    update_validation_status TEXT NOT NULL DEFAULT 'none',
    update_previous_version TEXT NOT NULL DEFAULT '',
    update_target_version TEXT NOT NULL DEFAULT '',
    update_safety_backup_id INTEGER,
    update_rollback_attempted INTEGER NOT NULL DEFAULT 0,
    update_validation_started_at INTEGER,
    managed_directory INTEGER NOT NULL DEFAULT 1,
    server_password TEXT NOT NULL DEFAULT '',
    admin_password TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL DEFAULT '',
    eula_accepted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_started_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS server_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, game_id TEXT NOT NULL, config TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS console_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    source TEXT NOT NULL DEFAULT 'Server',
    message TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS logs_server_idx ON console_logs (server_id, id)`,
  `CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    external_id TEXT NOT NULL,
    is_online INTEGER NOT NULL DEFAULT 0,
    is_op INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0,
    play_minutes INTEGER NOT NULL DEFAULT 0,
    ping INTEGER NOT NULL DEFAULT 0,
    trusted INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS players_server_idx ON players (server_id)`,
  `CREATE TABLE IF NOT EXISTS tool_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_id TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', rollback_available INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS tool_inventory (id TEXT PRIMARY KEY, name TEXT NOT NULL, ownership TEXT NOT NULL, path_category TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 0, detected_version TEXT NOT NULL DEFAULT '', expected_version TEXT NOT NULL DEFAULT '', integrity_status TEXT NOT NULL DEFAULT 'unknown', last_verified_at INTEGER, last_used_at INTEGER, last_error TEXT NOT NULL DEFAULT '', update_status TEXT NOT NULL DEFAULT 'unchecked', available_version TEXT NOT NULL DEFAULT '', update_source TEXT NOT NULL DEFAULT '', last_update_check_at INTEGER, fingerprint_sha256 TEXT NOT NULL DEFAULT '', fingerprint_size INTEGER NOT NULL DEFAULT 0, signature_status TEXT NOT NULL DEFAULT 'unchecked', signature_publisher TEXT NOT NULL DEFAULT '', signature_thumbprint TEXT NOT NULL DEFAULT '', signature_verified_at INTEGER, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tool_operations (id INTEGER PRIMARY KEY AUTOINCREMENT, tool_id TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', version_before TEXT NOT NULL DEFAULT '', version_after TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL, completed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, retry_of_run_id INTEGER, task_id INTEGER NOT NULL, server_id INTEGER NOT NULL, task_name TEXT NOT NULL, type TEXT NOT NULL, command TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS moderation_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL, player_id INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, command TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, expiration_attempts INTEGER NOT NULL DEFAULT 0, last_expiration_attempt_at INTEGER, expires_at INTEGER, created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS player_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER NOT NULL, provider TEXT NOT NULL, observation_key TEXT NOT NULL, display_name TEXT NOT NULL, joined_at INTEGER NOT NULL, left_at INTEGER, duration_sec INTEGER NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    size_mb INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'complete',
    note TEXT NOT NULL DEFAULT '',
    archive_path TEXT NOT NULL DEFAULT '',
    checksum TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS backups_server_idx ON backups (server_id)`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '',
    interval_min INTEGER NOT NULL DEFAULT 360,
    schedule_kind TEXT NOT NULL DEFAULT 'interval',
    schedule_time TEXT NOT NULL DEFAULT '09:00',
    schedule_weekday INTEGER NOT NULL DEFAULT 1,
    missed_policy TEXT NOT NULL DEFAULT 'run',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    next_run_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_server_idx ON tasks (server_id)`,
  `CREATE TABLE IF NOT EXISTS addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    author TEXT NOT NULL DEFAULT 'unknown',
    source TEXT NOT NULL DEFAULT 'Modrinth',
    summary TEXT NOT NULL DEFAULT '',
    downloads INTEGER NOT NULL DEFAULT 0,
    project_id TEXT NOT NULL DEFAULT '',
    file_path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS addons_server_idx ON addons (server_id)`,
  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS files_server_idx ON files (server_id)`,
  `CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER,
    kind TEXT NOT NULL DEFAULT 'server',
    message TEXT NOT NULL,
    ts INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS activity_ts_idx ON activity (id)`,
  `CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, server_id INTEGER, severity TEXT NOT NULL DEFAULT 'warning',
    component TEXT NOT NULL, summary TEXT NOT NULL, remediation TEXT NOT NULL DEFAULT '', resolved INTEGER NOT NULL DEFAULT 0,
    related_type TEXT NOT NULL DEFAULT '', related_id INTEGER, created_at INTEGER NOT NULL, resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS incidents_server_idx ON incidents (server_id, id)`,
  `CREATE TABLE IF NOT EXISTS installation_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'install',
    status TEXT NOT NULL DEFAULT 'queued',
    phase TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    bytes_done INTEGER NOT NULL DEFAULT 0,
    bytes_total INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT 'Waiting to install',
    error TEXT NOT NULL DEFAULT '',
    attempt INTEGER NOT NULL DEFAULT 1,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS installation_jobs_server_idx ON installation_jobs (server_id, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS installation_jobs_one_active_idx
    ON installation_jobs (server_id)
    WHERE status IN ('queued', 'running', 'cancelling')`,
  `CREATE TABLE IF NOT EXISTS installation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    server_id INTEGER NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    phase TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS installation_events_job_idx ON installation_events (job_id, id)`,
  `CREATE INDEX IF NOT EXISTS installation_events_server_idx ON installation_events (server_id, id)`,
];

/** A DatabaseSync exposing the small surface Drizzle's SQLite session expects. */
export type SqliteClient = DatabaseSync & Record<string, unknown>;

let raw: DatabaseSync | null = null;
let wrapped: SqliteClient | null = null;

const ADDITIVE_MIGRATIONS: Record<string, Record<string, string>> = {
  servers: {
    bind_address: "TEXT NOT NULL DEFAULT '192.168.1.210'",
    public_address: "TEXT NOT NULL DEFAULT '185.83.148.20'",
    readiness_timeout_sec: "INTEGER NOT NULL DEFAULT 60",
    health_status: "TEXT NOT NULL DEFAULT 'unknown'",
    health_reason: "TEXT NOT NULL DEFAULT ''",
    health_probe: "TEXT NOT NULL DEFAULT 'none'",
    health_failures: "INTEGER NOT NULL DEFAULT 0",
    query_metadata: "TEXT NOT NULL DEFAULT ''",
    last_query_at: "INTEGER",
    last_health_success_at: "INTEGER",
    last_health_failure_at: "INTEGER",
    launch_command: "TEXT NOT NULL DEFAULT ''",
    launch_args: "TEXT NOT NULL DEFAULT ''",
    working_directory: "TEXT NOT NULL DEFAULT ''",
    auto_restart: "INTEGER NOT NULL DEFAULT 0",
    max_crash_restarts: "INTEGER NOT NULL DEFAULT 3",
    restart_window_sec: "INTEGER NOT NULL DEFAULT 300",
    auto_backup_before_update: "INTEGER NOT NULL DEFAULT 1",
    update_backup_retention: "INTEGER NOT NULL DEFAULT 5",
    update_validation_status: "TEXT NOT NULL DEFAULT 'none'",
    update_previous_version: "TEXT NOT NULL DEFAULT ''",
    update_target_version: "TEXT NOT NULL DEFAULT ''",
    update_safety_backup_id: "INTEGER",
    update_rollback_attempted: "INTEGER NOT NULL DEFAULT 0",
    update_validation_started_at: "INTEGER",
    managed_directory: "INTEGER NOT NULL DEFAULT 1",
    server_password: "TEXT NOT NULL DEFAULT ''",
    admin_password: "TEXT NOT NULL DEFAULT ''",
    owner_id: "TEXT NOT NULL DEFAULT ''",
    eula_accepted: "INTEGER NOT NULL DEFAULT 0",
  },
  tool_inventory: { update_status: "TEXT NOT NULL DEFAULT 'unchecked'", available_version: "TEXT NOT NULL DEFAULT ''", update_source: "TEXT NOT NULL DEFAULT ''", last_update_check_at: "INTEGER", fingerprint_sha256: "TEXT NOT NULL DEFAULT ''", fingerprint_size: "INTEGER NOT NULL DEFAULT 0", signature_status: "TEXT NOT NULL DEFAULT 'unchecked'", signature_publisher: "TEXT NOT NULL DEFAULT ''", signature_thumbprint: "TEXT NOT NULL DEFAULT ''", signature_verified_at: "INTEGER" },
  tasks: { missed_policy: "TEXT NOT NULL DEFAULT 'run'", schedule_time: "TEXT NOT NULL DEFAULT '09:00'", schedule_weekday: "INTEGER NOT NULL DEFAULT 1", schedule_kind: "TEXT NOT NULL DEFAULT 'interval'" },
  task_runs: { retry_of_run_id: "INTEGER" },
  moderation_actions: { expires_at: "INTEGER", expiration_attempts: "INTEGER NOT NULL DEFAULT 0", last_expiration_attempt_at: "INTEGER" },
  players: { trusted: "INTEGER NOT NULL DEFAULT 0", notes: "TEXT NOT NULL DEFAULT ''" },
  backups: {
    archive_path: "TEXT NOT NULL DEFAULT ''",
    checksum: "TEXT NOT NULL DEFAULT ''",
  },
  addons: {
    project_id: "TEXT NOT NULL DEFAULT ''",
    file_path: "TEXT NOT NULL DEFAULT ''",
  },
};

export const SCHEMA_VERSION = 21500;

function migrate(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT NOT NULL
  )`);
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(SCHEMA_VERSION);
  if (applied) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [table, columns] of Object.entries(ADDITIVE_MIGRATIONS)) {
      const existing = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((column) => column.name)
      );
      for (const [name, declaration] of Object.entries(columns)) {
        if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
      }
    }
    // v2.1.1 corrects the deployment model: bind to the server PC's LAN
    // interface while NAT exposes the separate fixed public address.
    db.prepare("UPDATE servers SET bind_address = ? WHERE bind_address = ?")
      .run("192.168.1.210", "185.83.148.20");
    db.prepare("INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)")
      .run(SCHEMA_VERSION, Math.floor(Date.now() / 1000), "Add readiness-gated update validation state");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function boot(db: DatabaseSync): DatabaseSync {
  // Wait rather than failing when another process briefly holds the write lock.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  for (const stmt of DDL) db.exec(stmt);
  migrate(db);
  return db;
}

function open(): DatabaseSync {
  if (raw) return raw;
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const existed = fs.existsSync(/* turbopackIgnore: true */ dbPath) && fs.statSync(/* turbopackIgnore: true */ dbPath).size > 0;
    const client = new DatabaseSync(dbPath);
    const hasLedger = existed && client.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    if (existed && !hasLedger) {
      const backup = `${dbPath}.pre-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      fs.copyFileSync(dbPath, backup);
    }
    raw = boot(client);
  } catch (err) {
    console.warn(`[serverhub] could not open ${dbPath} (${String(err)}), using an in-memory database`);
    raw = boot(new DatabaseSync(":memory:"));
  }
  return raw;
}

export function sqliteClient(): SqliteClient {
  if (wrapped) return wrapped;
  const db = open() as SqliteClient;
  const nativePrepare = db.prepare.bind(db) as unknown as (sql: string) => {
    run: (...p: unknown[]) => unknown;
    all: (...p: unknown[]) => unknown;
    get: (...p: unknown[]) => unknown;
    setReturnArrays: (v: boolean) => void;
  };

  db.prepare = ((sql: string) => {
    const stmt = nativePrepare(sql);
    return {
      run: (...p: unknown[]) => stmt.run(...(p as never[])),
      all: (...p: unknown[]) => stmt.all(...(p as never[])),
      get: (...p: unknown[]) => stmt.get(...(p as never[])),
      // Drizzle calls .raw() when it maps the result columns itself.
      raw: () => ({
        all: (...p: unknown[]) => {
          stmt.setReturnArrays(true);
          const rows = stmt.all(...(p as never[]));
          stmt.setReturnArrays(false);
          return rows;
        },
        get: (...p: unknown[]) => {
          stmt.setReturnArrays(true);
          const row = stmt.get(...(p as never[]));
          stmt.setReturnArrays(false);
          return row;
        },
      }),
    };
  }) as never;

  // Not used by the app, but provided so Drizzle's transaction API resolves.
  db.transaction = ((fn: (tx: unknown) => unknown) => {
    const runner = (tx: unknown) => {
      db.exec("BEGIN");
      try {
        const out = fn(tx);
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    };
    for (const b of ["deferred", "immediate", "exclusive", "readonly"] as const)
      (runner as unknown as Record<string, unknown>)[b] = runner;
    return runner;
  }) as never;

  wrapped = db;
  return db;
}

export type Db = ReturnType<typeof drizzle<typeof schema>>;

const g = globalThis as typeof globalThis & { __serverhubDb?: Db };

export const db: Db = g.__serverhubDb ?? (drizzle(sqliteClient() as never, { schema }) as unknown as Db);

if (process.env.NODE_ENV !== "production") g.__serverhubDb = db;

export const sqlite = sqliteClient;
