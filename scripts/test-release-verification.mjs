#!/usr/bin/env node
// Regression coverage for scripts/verify-release-artifact.mjs. Builds tiny
// fixture bundles (archive + manifest + sums + SBOM + tagged package.json),
// asserts that a fully consistent bundle verifies, and that every tampered or
// inconsistent variant is rejected.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipArchive } from "archiver";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifier = path.join(root, "scripts", "verify-release-artifact.mjs");
const commit = "4bbe138ba05153647a8d047541c7b03d867c5555";
const otherCommit = "85aba71b612b09fd82add00c66b075ae823273e7";
const version = "9.9.9";

async function writeZip(file, buildInfo) {
  const output = fs.createWriteStream(file);
  const zip = new ZipArchive({ zlib: { level: 9 } });
  zip.pipe(output);
  zip.append(Buffer.from(JSON.stringify(buildInfo, null, 2) + "\n"), { name: "ServerHub/resources/server/build-info.json" });
  zip.append(Buffer.from("fixture launcher\n"), { name: "ServerHub/ServerHub.exe" });
  await zip.finalize();
  await new Promise((resolve, reject) => { output.on("close", resolve); output.on("error", reject); });
}

async function bundle(config = {}) {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), "serverhub-release-verify-"));
  const buildInfo = {
    version,
    sourceCommit: config.buildInfoCommit ?? commit,
    sourceState: "clean",
    sourceEpoch: 1790720494,
    buildEpoch: 1790720494,
    node: "v24.21.0",
    npm: "10.9.8",
    target: { platform: "win32", architecture: "x64" },
    lockfileSha256: "0f219e2c73b69d9bbe80af1605682e20b7fb8335f5b4e79771dc6c53c9d9dedd",
  };
  const artifact = path.join(work, `ServerHub-${version}-Windows-x64-Portable.zip`);
  await writeZip(artifact, buildInfo);
  const bytes = await fsp.readFile(artifact);
  const buildInfoChecksum = crypto.createHash("sha256").update(JSON.stringify(buildInfo, null, 2) + "\n").digest("hex");
  const sbomName = `serverhub-${version}-sbom.cdx.json`;
  const defaultSbomText = JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", components: [] }, null, 2) + "\n";
  const sbomText = config.sbomText ?? defaultSbomText;
  const manifest = {
    artifact: path.basename(artifact),
    size: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sourceCommit: commit,
    buildInfoChecksum,
    sbom: { name: sbomName, sha256: crypto.createHash("sha256").update(defaultSbomText).digest("hex") },
    testResults: "validated by release test summary",
  };
  if (config.manifest) config.manifest(manifest);
  await fsp.writeFile(path.join(work, "package.json"), JSON.stringify({ name: "server-hub", version }, null, 2));
  await fsp.writeFile(path.join(work, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await fsp.writeFile(path.join(work, "SHA256SUMS"), config.sums ?? `${manifest.sha256}  ${manifest.artifact}\n`);
  await fsp.writeFile(path.join(work, sbomName), sbomText);
  return { work, artifact, manifest, sbomName };
}

function verify(fixture, tag = `v${version}`, tagCommit = commit, withSbom = true) {
  const args = ["--artifact", fixture.artifact, "--manifest", path.join(fixture.work, "release-manifest.json"),
    "--sums", path.join(fixture.work, "SHA256SUMS"), "--tag", tag, "--commit", tagCommit];
  if (withSbom) args.push("--sbom", path.join(fixture.work, fixture.sbomName));
  return spawnSync(process.execPath, [verifier, ...args], { cwd: fixture.work, encoding: "utf8" });
}

async function check(label, config, expectation, { tag, tagCommit, withSbom = true } = {}) {
  const fixture = await bundle(config ?? {});
  try {
    const result = verify(fixture, tag, tagCommit, withSbom);
    const accepted = result.status === 0 && result.stdout.includes("RELEASE_ARTIFACT_VERIFIED");
    if (expectation === "accept" && !accepted) throw new Error(`${label} was not accepted: ${result.stderr || result.stdout}`);
    if (expectation === "reject" && accepted) throw new Error(`${label} was not rejected`);
  } finally {
    await fsp.rm(fixture.work, { recursive: true, force: true });
  }
}

async function checkPostMutate(label, mutate, expectation) {
  const fixture = await bundle();
  try {
    await mutate(fixture);
    const result = verify(fixture);
    const accepted = result.status === 0 && result.stdout.includes("RELEASE_ARTIFACT_VERIFIED");
    if (expectation === "accept" && !accepted) throw new Error(`${label} was not accepted: ${result.stderr || result.stdout}`);
    if (expectation === "reject" && accepted) throw new Error(`${label} was not rejected`);
  } finally {
    await fsp.rm(fixture.work, { recursive: true, force: true });
  }
}

await check("consistent bundle", undefined, "accept");
await checkPostMutate("corrupted artifact bytes", async (fixture) => {
  const bytes = Buffer.from(await fsp.readFile(fixture.artifact));
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  await fsp.writeFile(fixture.artifact, bytes);
}, "reject");
await checkPostMutate("artifact renamed to another version", async (fixture) => {
  const renamed = path.join(fixture.work, "ServerHub-9.9.8-Windows-x64-Portable.zip");
  await fsp.rename(fixture.artifact, renamed);
  fixture.artifact = renamed;
}, "reject");
await check("embedded provenance commit mismatch", { buildInfoCommit: otherCommit }, "reject");
await check("manifest commit mismatch", { manifest: (manifest) => { manifest.sourceCommit = otherCommit; } }, "reject");
await check("manifest size mismatch", { manifest: (manifest) => { manifest.size += 1; } }, "reject");
await check("manifest checksum mismatch", { manifest: (manifest) => { manifest.sha256 = "0".repeat(64); } }, "reject");
await check("manifest build-info checksum mismatch", { manifest: (manifest) => { manifest.buildInfoChecksum = "1".repeat(64); } }, "reject");
await check("manifest artifact name mismatch", { manifest: (manifest) => { manifest.artifact = "ServerHub-9.9.8-Windows-x64-Portable.zip"; } }, "reject");
await check("tampered SHA256SUMS", { sums: `${"2".repeat(64)}  ServerHub-${version}-Windows-x64-Portable.zip\n` }, "reject");
await check("SBOM mismatching the manifest", { sbomText: "{}\n" }, "reject");
await check("tag not matching package version", undefined, "reject", { tag: "v9.9.8" });
await check("tag commit mismatch", undefined, "reject", { tagCommit: otherCommit });
await check("non-semantic tag", undefined, "reject", { tag: "vLatest" });
await check("bundle without SBOM argument", undefined, "accept", { withSbom: false });
await checkPostMutate("missing embedded build-info", async (fixture) => {
  const replacement = path.join(fixture.work, "replaced.zip");
  const output = fs.createWriteStream(replacement);
  const zip = new ZipArchive({ zlib: { level: 9 } });
  zip.pipe(output);
  zip.append(Buffer.from("no provenance here\n"), { name: "ServerHub/ServerHub.exe" });
  await zip.finalize();
  await new Promise((resolve, reject) => { output.on("close", resolve); output.on("error", reject); });
  await fsp.rm(fixture.artifact, { force: true });
  await fsp.rename(replacement, fixture.artifact);
  // Keep the manifest authentic for the new bytes so only the missing
  // embedded provenance can cause the rejection.
  const bytes = await fsp.readFile(fixture.artifact);
  const manifest = JSON.parse(await fsp.readFile(path.join(fixture.work, "release-manifest.json"), "utf8"));
  manifest.size = bytes.length;
  manifest.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  manifest.buildInfoChecksum = crypto.createHash("sha256").update("no provenance here\n").digest("hex");
  await fsp.writeFile(path.join(fixture.work, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await fsp.writeFile(path.join(fixture.work, "SHA256SUMS"), `${manifest.sha256}  ${manifest.artifact}\n`);
}, "reject");

console.log("RELEASE_ARTIFACT_VERIFICATION_REGRESSION_OK");
