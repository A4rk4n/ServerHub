import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateServerBundle } from "./validate-package.mjs";

async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),"serverhub-package-test-"));for(const name of [".next","node_modules","public"])await fs.mkdir(path.join(root,name));for(const name of ["server.js","package.json","start.mjs","build-info.json"])await fs.writeFile(path.join(root,name),"{}");return root}
async function mustReject(label,mutate){const root=await fixture();try{await mutate(root);await validateServerBundle(root);throw new Error(`${label} fixture was not rejected`)}catch(error){if(error instanceof Error&&error.message===`${label} fixture was not rejected`)throw error}finally{await fs.rm(root,{recursive:true,force:true})}}

const valid=await fixture();await validateServerBundle(valid);await fs.rm(valid,{recursive:true,force:true});
await mustReject("recursive package",async root=>{const nested=path.join(root,"build","windows-portable","ServerHub","resources","server");await fs.mkdir(nested,{recursive:true});await fs.writeFile(path.join(nested,"ServerHub.exe"),"fixture")});
await mustReject("database",async root=>fs.writeFile(path.join(root,"serverhub.db"),"private"));
await mustReject("logs",async root=>fs.writeFile(path.join(root,"runtime.log"),"private"));
await mustReject("credentials",async root=>fs.writeFile(path.join(root,"credentials.json"),"private"));
await mustReject("world",async root=>fs.mkdir(path.join(root,"world")));
await mustReject("absolute developer path",async root=>fs.writeFile(path.join(root,"public","leak.txt"),"C:\\Users\\Ahri\\ServerHub\\src"));
if(process.platform!=="win32")await mustReject("symbolic link",async root=>fs.symlink(path.join(root,"server.js"),path.join(root,"public","server-link")));
const packager=await fs.readFile("scripts/build-windows-portable.mjs","utf8");if(!packager.includes('process.platform === "win32" ? "npm.cmd" : "npm"')||packager.includes('execFileSync("npm",'))throw new Error("Portable packager must invoke npm.cmd on Windows");
console.log("PACKAGE_CONTENT_EXCLUSION_REGRESSION_OK");
console.log("FINAL_NATIVE_PACKAGE_INTEGRITY_OK");
