import { DatabaseSync } from "node:sqlite";
import "../src/db/index";
const file=process.env.SERVERHUB_DB;if(!file)throw new Error("SERVERHUB_DB is required");
const db=new DatabaseSync(file);const templates=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='server_templates'").get();const migration=db.prepare("SELECT description FROM schema_migrations WHERE version=2920").get();const server=db.prepare("SELECT bind_address,public_address,health_status FROM servers LIMIT 1").get() as {bind_address:string;public_address:string;health_status:string};db.close();
if(!templates||!migration||server.bind_address!=="192.168.1.210"||server.public_address!=="185.83.148.20"||!server.health_status)process.exit(2);
