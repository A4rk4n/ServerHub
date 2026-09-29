import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export type AuthenticodeState = "valid" | "unsigned" | "invalid" | "unavailable" | "unsupported";
export type AuthenticodeResult = { state: AuthenticodeState; publisher: string; thumbprint: string; detail: string };
type SignatureJson = { Status?: string; StatusMessage?: string; Subject?: string; Thumbprint?: string };
type Runner = (command: string, args: string[]) => Promise<{ stdout: string }>;

function psLiteral(value: string) { return `'${value.replaceAll("'", "''")}'`; }

export function classifyAuthenticode(value: SignatureJson): AuthenticodeResult {
  const status = String(value.Status ?? "Unknown");
  const common = { publisher: String(value.Subject ?? "").slice(0, 500), thumbprint: String(value.Thumbprint ?? "").replace(/[^a-fA-F0-9]/g, "").toUpperCase().slice(0, 128), detail: String(value.StatusMessage ?? status).slice(0, 500) };
  if (status === "Valid") return { state: "valid", ...common };
  if (status === "NotSigned") return { state: "unsigned", ...common };
  return { state: "invalid", ...common };
}

const defaultRunner: Runner = async (command, args) => exec(command, args, { windowsHide: true, timeout: 15_000, maxBuffer: 256 * 1024 });

export async function verifyWindowsAuthenticode(file: string, runner: Runner = defaultRunner) {
  if (process.platform !== "win32" && runner === defaultRunner) return { state: "unsupported", publisher: "", thumbprint: "", detail: "Authenticode verification is available on Windows only" } satisfies AuthenticodeResult;
  const script = `$s=Get-AuthenticodeSignature -LiteralPath ${psLiteral(file)} -ErrorAction Stop; [pscustomobject]@{Status=[string]$s.Status;StatusMessage=$s.StatusMessage;Subject=if($s.SignerCertificate){$s.SignerCertificate.Subject}else{''};Thumbprint=if($s.SignerCertificate){$s.SignerCertificate.Thumbprint}else{''}}|ConvertTo-Json -Compress`;
  try {
    const { stdout } = await runner("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script]);
    return classifyAuthenticode(JSON.parse(stdout.trim()) as SignatureJson);
  } catch (error) {
    return { state: "unavailable", publisher: "", thumbprint: "", detail: error instanceof Error ? error.message.slice(0, 500) : "Authenticode verification failed" } satisfies AuthenticodeResult;
  }
}

export function assertSafeManagedSignature(result: AuthenticodeResult) {
  if (result.state === "invalid") throw new Error(`Managed executable has an invalid Authenticode signature: ${result.detail}`);
  if (result.state === "unavailable") throw new Error(`Authenticode verification was unavailable: ${result.detail}`);
  if (result.state === "unsupported") throw new Error("Authenticode verification requires Windows");
  // Some official vendor bootstrap executables are unsigned. Their limitation is
  // recorded explicitly while pinned-source HTTPS and SHA-256 controls remain active.
}
