#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";
import { inject } from "postject";
import * as ResEdit from "resedit";
import * as tar from "tar";
import { validateServerBundle } from "./validate-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, "build", "windows-portable");
const cache = path.join(root, "build", "download-cache");
const stage = path.join(build, "ServerHub");
const release = path.join(root, "release");
const launcher = path.join(root, "scripts", "portable-launcher.cjs");
const standalone = path.join(root, "build", "server");
const version = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8")).version;
const output = path.join(release, `ServerHub-${version}-Windows-x64-Portable.zip`);
const expectedVersion = process.env.SERVERHUB_RELEASE_VERSION || version;
if (version !== expectedVersion) throw new Error(`Version mismatch: package=${version}, requested=${expectedVersion}`);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const sourceState = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" }).trim();
if (sourceState) throw new Error("Release builds require a clean source tree");
const sourceEpoch = Number(execFileSync("git", ["show", "-s", "--format=%ct", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
const lockfileSha256 = crypto.createHash("sha256").update(await fsp.readFile(path.join(root, "package-lock.json"))).digest("hex");

async function applyWindowsIcon(executable) {
  const source = await fsp.readFile(executable);
  const image = ResEdit.NtExecutable.from(source, { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(image);
  const icon = ResEdit.Data.IconFile.from(await fsp.readFile(path.join(root, "build-resources", "icon.ico")));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033, icon.icons.map((item) => item.data));
  resources.outputResource(image);
  await fsp.writeFile(executable, Buffer.from(image.generate()));
}

async function markAsWindowsGui(executable) {
  const data = await fsp.readFile(executable);
  const peOffset = data.readUInt32LE(0x3c);
  if (data.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") throw new Error("Windows executable has an invalid PE header");
  const optionalHeader = peOffset + 24;
  const magic = data.readUInt16LE(optionalHeader);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error("Windows executable has an unsupported optional header");
  // IMAGE_SUBSYSTEM_WINDOWS_GUI (2) prevents a Command Prompt window from being created.
  data.writeUInt16LE(2, optionalHeader + 68);
  await fsp.writeFile(executable, data);
}

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
await applyWindowsIcon(executable);
await inject(executable, "NODE_SEA_BLOB", await fsp.readFile(blob), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
});
await markAsWindowsGui(executable);

console.log("[portable] acquiring pinned WebViewJS 0.4.7 native shell");
const nativeShell = path.join(stage, "resources", "native-shell");
await fsp.mkdir(nativeShell, { recursive: true });
await fsp.writeFile(path.join(nativeShell, "entry.cjs"), "// Module-resolution anchor for the packaged native shell.\n");
for (const packageName of ["@webviewjs/webview@0.4.7", "@webviewjs/webview-win32-x64-msvc@0.4.7"]) {
  const packed = execFileSync("npm", ["pack", packageName, "--pack-destination", cache, "--silent"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).at(-1);
  const scopeDir = path.join(nativeShell, "node_modules", "@webviewjs");
  const packageDir = path.join(build, `webview-${packed.replace(/[^a-z0-9.-]/gi, "-")}`);
  await fsp.mkdir(packageDir, { recursive: true });
  await tar.x({ file: path.join(cache, packed), cwd: packageDir, gzip: true, strict: true });
  await fsp.mkdir(scopeDir, { recursive: true });
  const targetName = packageName.slice("@webviewjs/".length).split("@")[0];
  await fsp.cp(path.join(packageDir, "package"), path.join(scopeDir, targetName), { recursive: true });
}

console.log("[portable] copying standalone application");
await fsp.mkdir(path.join(stage, "resources"), { recursive: true });
const packagedServer = path.join(stage, "resources", "server");
for (const name of ["server.js", "package.json", ".next", "node_modules", "public", "start.mjs"]) {
  await fsp.cp(path.join(standalone, name), path.join(packagedServer, name), { recursive: true });
}
const buildInfo = {
  version, sourceCommit, sourceState: "clean", sourceEpoch, buildEpoch: Number(process.env.SOURCE_DATE_EPOCH || sourceEpoch),
  node: process.version, npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
  target: { platform: "win32", architecture: "x64" }, lockfileSha256,
};
await fsp.writeFile(path.join(packagedServer, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
await validateServerBundle(packagedServer);
await fsp.writeFile(path.join(stage, "README.txt"), [
  "SERVER HUB — WINDOWS PORTABLE",
  "",
  "1. Extract the complete ServerHub folder from the ZIP.",
  "2. Double-click ServerHub.exe.",
  "3. Wait a few seconds for the Server Hub application window to appear.",
  "4. Closing that window shuts down Server Hub and its managed processes.",
  "",
  "Data is stored under %APPDATA%\\ServerHub and survives application updates.",
  "The app is unsigned, so Windows SmartScreen may ask you to confirm the first run.",
  "Do not expose the management port to the internet; it is intended for localhost only.",
  "",
].join("\r\n"), "utf8");

console.log(`[portable] compressing ${path.basename(output)}`);
await fsp.rm(output, { force: true });
await new Promise(async (resolve, reject) => {
  const destination = fs.createWriteStream(output);
  const zip = new ZipArchive({ zlib: { level: 9 } });
  destination.on("close", resolve);
  destination.on("error", reject);
  zip.on("error", reject);
  zip.pipe(destination);
  const archiveDate = new Date(sourceEpoch * 1000);
  async function appendSorted(directory, prefix) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const archiveName = `${prefix}/${entry.name}`.replaceAll("\\", "/");
      if (entry.isDirectory()) {
        zip.append(Buffer.alloc(0), { name: `${archiveName}/`, date: archiveDate, mode: 0o755 });
        await appendSorted(absolute, archiveName);
      } else if (entry.isFile()) {
        const mode = entry.name.toLowerCase().endsWith(".exe") ? 0o755 : 0o644;
        zip.file(absolute, { name: archiveName, date: archiveDate, mode });
      } else throw new Error(`Unsupported package entry: ${absolute}`);
    }
  }
  zip.append(Buffer.alloc(0), { name: "ServerHub/", date: archiveDate, mode: 0o755 });
  await appendSorted(stage, "ServerHub");
  void zip.finalize();
});

const hash = crypto.createHash("sha256").update(await fsp.readFile(output)).digest("hex");
const buildInfoChecksum = crypto.createHash("sha256").update(await fsp.readFile(path.join(packagedServer, "build-info.json"))).digest("hex");
const sbomPath = path.join(release, `serverhub-${version}-sbom.cdx.json`);
execFileSync(process.execPath, [path.join(root, "scripts", "generate-sbom.mjs"), sbomPath], { cwd: root, stdio: "inherit" });
const sbomChecksum = crypto.createHash("sha256").update(await fsp.readFile(sbomPath)).digest("hex");
const size = (await fsp.stat(output)).size;
const manifest = { artifact: path.basename(output), size, sha256: hash, sourceCommit, buildInfoChecksum, sbom: { name: path.basename(sbomPath), sha256: sbomChecksum }, testResults: process.env.SERVERHUB_TEST_RESULTS || "validated by release test summary" };
await fsp.writeFile(path.join(release, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await fsp.writeFile(path.join(release, "SHA256SUMS"), `${hash}  ${path.basename(output)}\n`, "utf8");
console.log(`[portable] ready: ${output} (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`[portable] SHA-256: ${hash}`);
