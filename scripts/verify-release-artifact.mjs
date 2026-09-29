#!/usr/bin/env node
// Verifies a Windows portable release artifact against the release manifest,
// SHA256SUMS, and the provenance that scripts/build-windows-portable.mjs
// embeds inside the ZIP. The Promote release workflow refuses to publish
// unless every check passes. The archive is never extracted; build-info.json
// is located through the ZIP central directory and read through a bounded
// stream, mirroring the runtime's bounded-extraction rules.
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { openPromise } from "yauzl";

const BUILD_INFO_ENTRY = "ServerHub/resources/server/build-info.json";
const BUILD_INFO_MAX_BYTES = 64 * 1024;
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const FILENAME_PATTERN = /^ServerHub-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-Windows-x64-Portable\.zip$/;

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  if (!key.startsWith("--") || index + 1 >= process.argv.length) usage();
  args.set(key.slice(2), process.argv[index + 1]);
}
function usage() {
  console.error("usage: node scripts/verify-release-artifact.mjs --artifact <zip> --manifest <release-manifest.json> --sums <SHA256SUMS> --tag <vX.Y.Z> --commit <40-char sha> [--sbom <sbom.cdx.json>]");
  process.exit(2);
}
for (const required of ["artifact", "manifest", "sums", "tag", "commit"]) if (!args.get(required)) usage();

const artifactArg = path.resolve(args.get("artifact"));
const manifestArg = path.resolve(args.get("manifest"));
const sumsArg = path.resolve(args.get("sums"));
const sbomArg = args.get("sbom") ? path.resolve(args.get("sbom")) : null;
const tag = args.get("tag");
const commit = args.get("commit");

function fail(message) {
  console.error(`release-artifact: ${message}`);
  process.exit(1);
}

if (!TAG_PATTERN.test(tag)) fail(`tag "${tag}" is not a semantic version tag such as v2.11.1`);
if (!COMMIT_PATTERN.test(commit)) fail(`commit "${commit}" is not a full 40-character commit id`);

// The expected version comes from the tagged checkout this script runs in,
// not from the artifact, so the artifact cannot declare its own version.
const pkg = JSON.parse(await fsp.readFile("package.json", "utf8"));
if (typeof pkg.version !== "string" || pkg.version.length === 0) fail("package.json has no version");
if (tag !== `v${pkg.version}`) fail(`tag ${tag} does not match package.json version ${pkg.version}`);
const expectedFilename = `ServerHub-${pkg.version}-Windows-x64-Portable.zip`;
const filenameMatch = FILENAME_PATTERN.exec(path.basename(artifactArg));
if (path.basename(artifactArg) !== expectedFilename || !filenameMatch || filenameMatch[1] !== pkg.version) {
  fail(`artifact filename must be ${expectedFilename}`);
}

async function sha256File(file) {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("close", () => resolve(hash.digest("hex")));
  });
}

// Read one bounded member out of the archive without extracting anything.
async function readBuildInfo(archive) {
  const zip = await openPromise(archive, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, autoClose: false });
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        try { zip.close(); } catch { /* already closed */ }
        if (error) reject(error);
        else resolve(value);
      };
      zip.once("error", (error) => finish(error));
      zip.once("end", () => finish(new Error(`${BUILD_INFO_ENTRY} is missing from the archive`)));
      zip.on("entry", (entry) => {
        if (entry.fileName !== BUILD_INFO_ENTRY) {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > BUILD_INFO_MAX_BYTES) {
          finish(new Error(`${BUILD_INFO_ENTRY} is unexpectedly large (${entry.uncompressedSize} bytes)`));
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            finish(error ?? new Error(`could not read ${BUILD_INFO_ENTRY}`));
            return;
          }
          const chunks = [];
          let total = 0;
          stream.on("data", (chunk) => {
            total += chunk.length;
            if (total > BUILD_INFO_MAX_BYTES) {
              stream.destroy();
              finish(new Error(`${BUILD_INFO_ENTRY} exceeded the ${BUILD_INFO_MAX_BYTES}-byte read limit`));
            } else chunks.push(chunk);
          });
          stream.on("error", (error) => finish(error));
          stream.on("end", () => finish(null, Buffer.concat(chunks)));
        });
      });
      zip.readEntry();
    });
  } catch (error) {
    try { zip.close(); } catch { /* already closed */ }
    throw error;
  }
}

const manifest = JSON.parse(await fsp.readFile(manifestArg, "utf8"));
if (manifest.artifact !== expectedFilename) fail(`release manifest names "${manifest.artifact}" but the expected artifact is ${expectedFilename}`);
if (manifest.sourceCommit !== commit) fail(`release manifest source commit ${manifest.sourceCommit} does not match tag commit ${commit}`);

const size = (await fsp.stat(artifactArg)).size;
if (!Number.isSafeInteger(manifest.size) || manifest.size !== size) fail(`release manifest size ${manifest.size} does not match actual size ${size}`);

const sha256 = await sha256File(artifactArg);
if (manifest.sha256 !== sha256) fail(`release manifest SHA-256 ${manifest.sha256} does not match actual ${sha256}`);

const sums = await fsp.readFile(sumsArg, "utf8");
const sumLines = sums.split(/\r?\n/).filter((line) => line.trim().length > 0);
if (sumLines.length !== 1) fail(`SHA256SUMS must contain exactly one line, found ${sumLines.length}`);
const sumParts = sumLines[0].split(/\s+/);
if (sumParts.length !== 2 || sumParts[0] !== sha256 || sumParts[1] !== expectedFilename) {
  fail(`SHA256SUMS does not authenticate ${expectedFilename} with ${sha256}`);
}

const buildInfoBuffer = await readBuildInfo(artifactArg);
const buildInfoChecksum = crypto.createHash("sha256").update(buildInfoBuffer).digest("hex");
if (manifest.buildInfoChecksum !== buildInfoChecksum) fail(`release manifest build-info checksum ${manifest.buildInfoChecksum} does not match embedded ${buildInfoChecksum}`);
let buildInfo;
try {
  buildInfo = JSON.parse(buildInfoBuffer.toString("utf8"));
} catch {
  fail("embedded build-info.json is not valid JSON");
}
if (buildInfo.version !== pkg.version) fail(`embedded build-info version ${buildInfo.version} does not match ${pkg.version}`);
if (buildInfo.sourceCommit !== commit) fail(`embedded build-info source commit ${buildInfo.sourceCommit} does not match tag commit ${commit}`);
if (buildInfo.sourceState !== "clean") fail(`embedded build-info source state is "${buildInfo.sourceState}", expected "clean"`);
if (buildInfo.target?.platform !== "win32" || buildInfo.target?.architecture !== "x64") fail("embedded build-info target is not win32/x64");

if (sbomArg) {
  if (manifest.sbom?.name !== path.basename(sbomArg)) fail(`release manifest SBOM name "${manifest.sbom?.name}" does not match ${path.basename(sbomArg)}`);
  const sbomSha256 = await sha256File(sbomArg);
  if (manifest.sbom.sha256 !== sbomSha256) fail(`release manifest SBOM checksum ${manifest.sbom.sha256} does not match actual ${sbomSha256}`);
}

console.log("RELEASE_ARTIFACT_VERIFIED", JSON.stringify({
  artifact: expectedFilename,
  version: pkg.version,
  sourceCommit: commit,
  size,
  sha256,
  buildInfoChecksum,
  sbom: manifest.sbom ? manifest.sbom.name : null,
}));
