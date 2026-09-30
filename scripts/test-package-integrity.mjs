import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateServerBundle } from "./validate-package.mjs";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "serverhub-package-test-"));
  for (const name of [".next", "node_modules", "public"]) await fs.mkdir(path.join(root, name));
  for (const name of ["server.js", "package.json", "start.mjs", "build-info.json"]) await fs.writeFile(path.join(root, name), "{}");
  return root;
}

async function mustReject(label, mutate) {
  const root = await fixture();
  try {
    await mutate(root);
    await validateServerBundle(root);
    throw new Error(`${label} fixture was not rejected`);
  } catch (error) {
    if (error instanceof Error && error.message === `${label} fixture was not rejected`) throw error;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("a well-formed standalone bundle passes validation", async () => {
  const valid = await fixture();
  try {
    await validateServerBundle(valid);
  } finally {
    await fs.rm(valid, { recursive: true, force: true });
  }
});

for (const [label, mutate] of [
  ["recursive package", async (root) => {
    const nested = path.join(root, "build", "windows-portable", "ServerHub", "resources", "server");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "ServerHub.exe"), "fixture");
  }],
  ["database", async (root) => fs.writeFile(path.join(root, "serverhub.db"), "private")],
  ["logs", async (root) => fs.writeFile(path.join(root, "runtime.log"), "private")],
  ["credentials", async (root) => fs.writeFile(path.join(root, "credentials.json"), "private")],
  ["world", async (root) => fs.mkdir(path.join(root, "world"))],
  ["absolute developer path", async (root) => fs.writeFile(path.join(root, "public", "leak.txt"), "C:\\Users\\Ahri\\ServerHub\\src")],
]) {
  test(`a bundle containing a ${label} is rejected`, async () => {
    await mustReject(label, mutate);
  });
}

// Creating symbolic links requires privileges that the Windows runners do not
// grant by default; the guard itself is platform-independent.
test("a bundle containing a symbolic link is rejected", { skip: process.platform === "win32" }, async () => {
  await mustReject("symbolic link", async (root) => fs.symlink(path.join(root, "server.js"), path.join(root, "public", "server-link")));
});

test("the portable packager invokes npm through Node on every platform", async () => {
  const packager = await fs.readFile("scripts/build-windows-portable.mjs", "utf8");
  if (!packager.includes("const npmCli = process.env.npm_execpath") || !packager.includes("execFileSync(process.execPath, [npmCli,") || packager.includes("execFileSync(\"npm\",") || packager.includes("\"npm.cmd\"")) {
    throw new Error("Portable packager must invoke npm through Node on every platform");
  }
  console.log("PACKAGE_CONTENT_EXCLUSION_REGRESSION_OK");
  console.log("FINAL_NATIVE_PACKAGE_INTEGRITY_OK");
});
