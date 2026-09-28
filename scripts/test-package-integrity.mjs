import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateServerBundle } from "./validate-package.mjs";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "serverhub-package-test-"));
for (const name of [".next", "node_modules", "public"]) await fs.mkdir(path.join(root, name));
for (const name of ["server.js", "package.json", "start.mjs", "build-info.json"]) await fs.writeFile(path.join(root, name), "{}");
await validateServerBundle(root);
await fs.mkdir(path.join(root, "build", "windows-portable", "ServerHub", "resources", "server"), { recursive: true });
await fs.writeFile(path.join(root, "build", "windows-portable", "ServerHub", "resources", "server", "ServerHub.exe"), "recursive fixture");
let rejected = false;
try { await validateServerBundle(root); } catch { rejected = true; }
if (!rejected) throw new Error("Recursive package fixture was not rejected");
await fs.rm(root, { recursive: true, force: true });
console.log("FINAL_NATIVE_PACKAGE_INTEGRITY_OK");
