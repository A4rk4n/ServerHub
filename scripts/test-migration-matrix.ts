import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

async function main(){
const root=await fsp.mkdtemp(path.join(os.tmpdir(),"serverhub-matrix-"));
try {
 for(const version of [2600,2700]){
  const file=path.join(root,`v${version}.db`),db=new DatabaseSync(file);
  db.exec(`CREATE TABLE servers (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,game_id TEXT NOT NULL,version TEXT NOT NULL,loader TEXT NOT NULL DEFAULT 'vanilla',status TEXT NOT NULL DEFAULT 'offline',port INTEGER NOT NULL,memory_mb INTEGER NOT NULL DEFAULT 4096,max_players INTEGER NOT NULL DEFAULT 20,motd TEXT NOT NULL DEFAULT '',world_name TEXT NOT NULL DEFAULT 'world',seed TEXT NOT NULL DEFAULT '',difficulty TEXT NOT NULL DEFAULT 'normal',pvp INTEGER NOT NULL DEFAULT 1,launch_command TEXT NOT NULL DEFAULT '',launch_args TEXT NOT NULL DEFAULT '',working_directory TEXT NOT NULL DEFAULT '',managed_directory INTEGER NOT NULL DEFAULT 1,server_password TEXT NOT NULL DEFAULT '',admin_password TEXT NOT NULL DEFAULT '',owner_id TEXT NOT NULL DEFAULT '',eula_accepted INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,last_started_at INTEGER);CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL,description TEXT NOT NULL);`);
  db.prepare("INSERT INTO servers(name,game_id,version,port,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("fixture","minecraft","latest",25565,1,1);db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(version,1,"fixture");db.close();
  const result=spawnSync(process.execPath,["--require","./scripts/register-better-sqlite3-stub.cjs","--import","tsx","scripts/migration-worker.ts"],{cwd:process.cwd(),env:{...process.env,SERVERHUB_DB:file},encoding:"utf8"});assert.equal(result.status,0,`v${version}: ${result.stderr||result.stdout}`);
  const migrated=new DatabaseSync(file);assert.equal((migrated.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE version=2900").get() as {n:number}).n,1);assert.equal((migrated.prepare("SELECT COUNT(*) n FROM servers").get() as {n:number}).n,1);migrated.close();
 }
 console.log("V260_V270_TO_V290_MIGRATION_MATRIX_OK");
} finally {await fsp.rm(root,{recursive:true,force:true})}

}
void main().catch(error=>{console.error(error);process.exit(1)});
