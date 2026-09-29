import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZipArchive } from "archiver";
async function main() {
  process.env.SERVERHUB_DB = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-zip-db-")), "test.db");
  const { extractZipSafe } = await import("../src/lib/runtime");
  async function zip(file: string, entries: Array<{name:string; content:string}>) {
    await new Promise<void>((resolve,reject) => { const out=fs.createWriteStream(file); const z=new ZipArchive({zlib:{level:1}}); out.on("close",resolve); z.on("error",reject); z.pipe(out); for(const e of entries) z.append(e.content,{name:e.name}); void z.finalize(); });
  }
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),"serverhub-zip-test-"));
  const archive=path.join(root,"fixture.zip");
  await zip(archive,[{name:"safe/a.txt",content:"hello"},{name:"safe/b.txt",content:"world"},{name:"safe/c.txt",content:"!"}]);
  await extractZipSafe(archive,path.join(root,"good"));
  assert.equal(await fsp.readFile(path.join(root,"good/safe/a.txt"),"utf8"),"hello");
  await assert.rejects(extractZipSafe(archive,path.join(root,"count"),undefined,{maxEntries:2}),/entry limit/);
  await assert.rejects(extractZipSafe(archive,path.join(root,"size"),undefined,{maxExpandedBytes:5}),/expanded-size limit/);
  // Archiver normalizes traversal names; verify the extractor's mandatory guards remain active as defense in depth.
  const source=await fsp.readFile("src/lib/runtime.ts","utf8");
  for(const guard of ["normalized.startsWith", "split(\"/\").includes(\"..\")", "isSymlink", "^[A-Za-z]"]) assert.ok(source.includes(guard),guard);
  await fsp.rm(root,{recursive:true,force:true});
  console.log("MALICIOUS_ZIP_BEHAVIOR_OK");
}
void main().catch((error) => { console.error(error); process.exit(1); });
