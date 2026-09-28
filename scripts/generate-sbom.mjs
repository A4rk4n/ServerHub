#!/usr/bin/env node
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const lock = JSON.parse(await fsp.readFile(path.join(root, "package-lock.json"), "utf8"));
const pkg = JSON.parse(await fsp.readFile(path.join(root, "package.json"), "utf8"));
const components = Object.entries(lock.packages ?? {}).filter(([key, value]) => key && value?.version).map(([key, value]) => {
  const name = key.split("node_modules/").at(-1);
  return { type: "library", name, version: value.version, purl: `pkg:npm/${encodeURIComponent(name)}@${value.version}` };
}).sort((a,b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
const serial = `urn:uuid:${crypto.createHash("sha256").update(`${pkg.name}@${pkg.version}:${lock.lockfileVersion}`).digest("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, "$1-$2-$3-$4-$5")}`;
const sbom = { bomFormat: "CycloneDX", specVersion: "1.5", serialNumber: serial, version: 1, metadata: { component: { type: "application", name: pkg.name, version: pkg.version } }, components };
const output = path.resolve(process.argv[2] || "release/serverhub-1.4.1-sbom.cdx.json");
await fsp.mkdir(path.dirname(output), { recursive: true });
await fsp.writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`);
console.log(`SBOM_OK ${components.length} components -> ${output}`);
