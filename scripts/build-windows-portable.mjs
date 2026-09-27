#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import { inject } from "postject";
import * as tar from "tar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, "build", "windows-portable");
const cache = path.join(root, "build", "download-cache");
const stage = path.join(build, "ServerHub");
const release = path.join(root, "release");
const launcher = path.join(root, "scripts", "portable-launcher.cjs");
const standalone = path.join(root, "build", "server");
const version = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8")).version;
const output = path.join(release, `ServerHub-${version}-Windows-x64-Portable.zip`);

if (!fs.existsSync(path.join(standalone, "server.js"))) {
  throw new Error("build/server/server.js is missing; run npm run build:server first");
}
if (process.platform !== "linux" && process.platform !== "darwin" && process.platform !== "win32") {
  throw new Error(`Unsupported build host: ${process.platform}`);
}

await fsp.rm(build, { recursive: true, force: true });
await fsp.mkdir(stage, { recursive: true });
await fsp.mkdir(cache, { recursive: true });
await fsp.mkdir(release, { recursive: true });

// Download the official Windows Node binary through npm's integrity-checked registry.
// Match the build-host Node exactly because SEA blobs are version-specific.
const nodePackage = `node-win-x64@${process.versions.node}`;
console.log(`[portable] acquiring ${nodePackage}`);
execFileSync("npm", ["pack", nodePackage, "--pack-destination", cache, "--silent"], { cwd: root, stdio: "inherit" });
const packageFile = path.join(cache, `node-win-x64-${process.versions.node}.tgz`);
const unpacked = path.join(build, "node-package");
await fsp.mkdir(unpacked, { recursive: true });
await tar.x({ file: packageFile, cwd: unpacked, gzip: true, strict: true });
const nodeExe = path.join(unpacked, "package", "bin", "node.exe");
if (!fs.existsSync(nodeExe)) throw new Error(`Windows Node executable missing from ${packageFile}`);

console.log("[portable] generating Node SEA launcher");
const blob = path.join(build, "serverhub-sea.blob");
const seaConfig = path.join(build, "sea-config.json");
await fsp.writeFile(seaConfig, JSON.stringify({
  main: launcher,
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}, null, 2));
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { cwd: root, stdio: "inherit" });

const executable = path.join(stage, "ServerHub.exe");
await fsp.copyFile(nodeExe, executable);
await inject(executable, "NODE_SEA_BLOB", await fsp.readFile(blob), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});

console.log("[portable] copying standalone application");
await fsp.mkdir(path.join(stage, "resources"), { recursive: true });
await fsp.cp(standalone, path.join(stage, "resources", "server"), { recursive: true });
await fsp.writeFile(path.join(stage, "README.txt"), [
  "SERVER HUB — WINDOWS PORTABLE",
  "",
  "1. Extract the complete ServerHub folder from the ZIP.",
  "2. Double-click ServerHub.exe.",
  "3. Keep the console window open while using your servers.",
  "4. The management UI opens in your default browser.",
  "",
  "Data is stored under %APPDATA%\\ServerHub and survives application updates.",
  "The app is unsigned, so Windows SmartScreen may ask you to confirm the first run.",
  "Do not expose the management port to the internet; it is intended for localhost only.",
  "",
], "utf8");

console.log(`[portable] compressing ${path.basename(output)}`);
await fsp.rm(output, { force: true });
await new Promise((resolve, reject) => {
  const destination = fs.createWriteStream(output);
  const zip = new ZipArchive({ zlib: { level: 9 } });
  destination.on("close", resolve);
  destination.on("error", reject);
  zip.on("error", reject);
  zip.pipe(destination);
  zip.directory(stage, "ServerHub");
  void zip.finalize();
});

const hash = crypto.createHash("sha256").update(await fsp.readFile(output)).digest("hex");
await fsp.writeFile(`${output}.sha256`, `${hash}  ${path.basename(output)}\n`, "utf8");
const size = (await fsp.stat(output)).size;
console.log(`[portable] ready: ${output} (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`[portable] SHA-256: ${hash}`);
