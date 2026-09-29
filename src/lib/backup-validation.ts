import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as tar from "tar";

export async function fileSha256(file:string){return new Promise<string>((resolve,reject)=>{const hash=crypto.createHash("sha256"),stream=fs.createReadStream(file);stream.on("data",chunk=>hash.update(chunk));stream.once("error",reject);stream.once("end",()=>resolve(hash.digest("hex")))})}

export async function inspectBackupArchive(file:string, expectedChecksum="") {
  const actualChecksum=await fileSha256(file); const entries:string[]=[];
  await tar.t({file,gzip:true,strict:true,onentry:entry=>{
    const normalized=entry.path.replaceAll("\\","/");
    if(path.posix.isAbsolute(normalized)||normalized.split("/").includes(".."))throw new Error(`Unsafe backup path: ${entry.path}`);
    if(entry.type==="SymbolicLink"||entry.type==="Link")throw new Error(`Backup links are not permitted: ${entry.path}`);
    if(entries.length>=5000)throw new Error("Backup contains too many entries"); entries.push(normalized);
  }});
  const stat=await fs.promises.stat(file);
  return {valid:!expectedChecksum||actualChecksum===expectedChecksum,actualChecksum,expectedChecksum,archiveBytes:stat.size,entries:entries.length,sample:entries.slice(0,20)};
}
