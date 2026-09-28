// Starts the bundled Server Hub server.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT || 4321;
const child = spawn(process.execPath, [path.join(here, "server.js")], {
  cwd: here,
  stdio: "inherit",
  env: { ...process.env, PORT: port, HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (c) => process.exit(c ?? 0));
