import assert from "node:assert/strict";
import test from "node:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

test("a v13 database migrates in place to the current schema version", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-migration-"));
  // The application database module opens the fixture at import time and keeps
  // the handle for the process lifetime. Close it before deleting the fixture:
  // Windows refuses to unlink a file with an open handle (EBUSY).
  let serverDb: typeof import("../src/db/index") | undefined;
  try {
    const file = path.join(root, "v13.db");
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, game_id TEXT NOT NULL, version TEXT NOT NULL,
      loader TEXT NOT NULL DEFAULT 'vanilla', status TEXT NOT NULL DEFAULT 'offline', port INTEGER NOT NULL,
      memory_mb INTEGER NOT NULL DEFAULT 4096, max_players INTEGER NOT NULL DEFAULT 20, motd TEXT NOT NULL DEFAULT '',
      world_name TEXT NOT NULL DEFAULT 'world', seed TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'normal',
      pvp INTEGER NOT NULL DEFAULT 1, launch_command TEXT NOT NULL DEFAULT '', launch_args TEXT NOT NULL DEFAULT '',
      working_directory TEXT NOT NULL DEFAULT '', managed_directory INTEGER NOT NULL DEFAULT 1,
      server_password TEXT NOT NULL DEFAULT '', admin_password TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL DEFAULT '',
      eula_accepted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_started_at INTEGER
    );`);
    db.prepare("INSERT INTO servers (name,game_id,version,port,created_at,updated_at) VALUES ('fixture','minecraft','latest',25565,1,1)").run();
    db.close();

    process.env.SERVERHUB_DB = file;
    serverDb = await import("../src/db/index");

    const migrated = new DatabaseSync(file);
    const columns = new Set((migrated.prepare("PRAGMA table_info(servers)").all() as { name: string }[]).map((x) => x.name));
    for (const name of ["auto_restart", "max_crash_restarts", "restart_window_sec", "auto_backup_before_update", "update_backup_retention", "backup_retention_count", "backup_retention_days", "bind_address", "public_address", "readiness_timeout_sec"]) {
      assert.ok(columns.has(name), name);
    }
    assert.equal((migrated.prepare("SELECT COUNT(*) AS n FROM servers").get() as { n: number }).n, 1);
    assert.equal((migrated.prepare("SELECT bind_address FROM servers WHERE id=1").get() as { bind_address: string }).bind_address, "192.168.1.210");
    assert.equal((migrated.prepare(`SELECT COUNT(*) AS n FROM schema_migrations WHERE version=${serverDb.SCHEMA_VERSION}`).get() as { n: number }).n, 1);
    migrated.close();
    assert.equal((await fsp.readdir(root)).some((name) => name.includes("pre-migration") && name.endsWith(".bak")), true);
    console.log("V13_TO_V215_MIGRATION_OK");
  } finally {
    try {
      serverDb?.sqliteClient().close();
    } catch {}
    await fsp.rm(root, { recursive: true, force: true });
  }
});
