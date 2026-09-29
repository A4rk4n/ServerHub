import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { hostPlatform } from "./host-platform";

const exec = promisify(execFile);
type ProcessRecord = { ProcessId?: number; ExecutablePath?: string | null };
type ProbeRunner = (command: string, args: string[]) => Promise<{ stdout: string }>;
const defaultRunner: ProbeRunner = async (command, args) => exec(command, args, { windowsHide: true, timeout: 10_000, maxBuffer: 256 * 1024 });

function psLiteral(value: string) { return `'${value.replaceAll("'", "''")}'`; }
function normalizeWindowsPath(value: string) { return path.win32.normalize(value).replace(/[\\/]+$/, "").toLowerCase(); }

export function parseManagedProcessProbe(stdout: string, managedExecutable: string) {
  if (!stdout.trim()) return [] as number[];
  const parsed = JSON.parse(stdout) as ProcessRecord | ProcessRecord[];
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const expected = normalizeWindowsPath(managedExecutable);
  return records.filter((item) => typeof item.ProcessId === "number" && typeof item.ExecutablePath === "string" && normalizeWindowsPath(item.ExecutablePath) === expected).map((item) => item.ProcessId as number);
}

export async function managedExecutablePids(managedExecutable: string, runner: ProbeRunner = defaultRunner) {
  if (hostPlatform() !== "win32" && runner === defaultRunner) return [];
  const name = path.win32.basename(managedExecutable);
  const script = `$items=Get-CimInstance Win32_Process -Filter ${psLiteral(`Name='${name.replaceAll("'", "''")}'`)} -ErrorAction Stop | Select-Object ProcessId,ExecutablePath; @($items)|ConvertTo-Json -Compress`;
  const { stdout } = await runner("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script]);
  return parseManagedProcessProbe(stdout, managedExecutable);
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Installation cancelled"));
    const timer = setTimeout(done, ms);
    function done() { signal.removeEventListener("abort", cancel); resolve(); }
    function cancel() { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(new Error("Installation cancelled")); }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

/** Wait only for processes whose reported executable path exactly matches the managed tool. */
export async function waitForManagedExecutableExit(managedExecutable: string, signal: AbortSignal, options: { timeoutMs?: number; intervalMs?: number; runner?: ProbeRunner } = {}) {
  if (hostPlatform() !== "win32" && !options.runner) return;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const pids = await managedExecutablePids(managedExecutable, options.runner ?? defaultRunner);
    if (!pids.length) return;
    if (Date.now() >= deadline) throw new Error(`Managed SteamCMD process is still running after ${Math.ceil(timeoutMs / 1000)} seconds; wait for it to finish, then retry`);
    await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())), signal);
  }
}
