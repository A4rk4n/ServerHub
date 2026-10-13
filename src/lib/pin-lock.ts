// Panel PIN lock: a local gate so other people at the same PC cannot
// wander into the server controls. The PIN is stored as a salted
// scrypt hash in appdata/pin-lock.json (0600); unlocking issues a
// stateless HMAC cookie signed with a per-PIN secret, so changing or
// disabling the PIN rotates the secret and invalidates every token.
// Off by default — nothing changes until a PIN is set.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { appDataDir } from "./storage";

export const PIN_COOKIE = "serverhub_pin";
export const PIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 30_000;

export type PinLockConfig = {
  enabled: boolean;
  salt: string;
  hash: string;
  secret: string;
};

export const PIN_DISABLED: PinLockConfig = { enabled: false, salt: "", hash: "", secret: "" };

export function validPinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,12}$/.test(pin);
}

function pinHash(pin: string, salt: string): Buffer {
  return scryptSync(pin, Buffer.from(salt, "hex"), 32, { N: 16384, r: 8, p: 1 });
}

export function createPinConfig(pin: string): PinLockConfig {
  if (!validPinFormat(pin)) throw new Error("A PIN is 4 to 12 digits");
  const salt = randomBytes(16).toString("hex");
  return {
    enabled: true,
    salt,
    hash: pinHash(pin, salt).toString("hex"),
    secret: randomBytes(32).toString("hex"),
  };
}

export function verifyPin(pin: unknown, config: PinLockConfig): boolean {
  if (!config.enabled || !validPinFormat(pin)) return false;
  const candidate = pinHash(pin, config.salt);
  const expected = Buffer.from(config.hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---- stateless unlock tokens ---------------------------------------------

function sign(secret: string, payload: string): string {
  return createHmac("sha256", Buffer.from(secret, "hex")).update(payload).digest("hex");
}

export function issuePinToken(config: PinLockConfig, now = Date.now(), ttlMs = PIN_TOKEN_TTL_MS): string {
  const expires = now + ttlMs;
  return `${expires}.${sign(config.secret, String(expires))}`;
}

export function verifyPinToken(token: unknown, config: PinLockConfig, now = Date.now()): boolean {
  if (!config.enabled || typeof token !== "string") return false;
  const [expiresRaw, signature] = token.split(".");
  const expires = Number(expiresRaw);
  if (!Number.isSafeInteger(expires) || expires <= now || !signature) return false;
  const expected = Buffer.from(sign(config.secret, String(expires)));
  const candidate = Buffer.from(signature);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---- brute-force throttle -------------------------------------------------

export type PinAttemptState = { failures: number; lockedUntil: number };

export function attemptBlocked(state: PinAttemptState | undefined, now = Date.now()): number {
  if (!state) return 0;
  return state.lockedUntil > now ? state.lockedUntil - now : 0;
}

export function nextAttemptState(prev: PinAttemptState | undefined, ok: boolean, now = Date.now()): PinAttemptState {
  if (ok) return { failures: 0, lockedUntil: 0 };
  const failures = (prev?.failures ?? 0) + 1;
  return { failures, lockedUntil: failures >= PIN_MAX_ATTEMPTS ? now + PIN_LOCKOUT_MS : prev?.lockedUntil ?? 0 };
}

// ---- persistence -----------------------------------------------------------

export function pinLockFile(base?: string): string {
  return path.join(base ?? appDataDir(), "pin-lock.json");
}

export async function loadPinLock(base?: string): Promise<PinLockConfig> {
  try {
    const raw = JSON.parse(await fsp.readFile(pinLockFile(base), "utf8")) as Partial<PinLockConfig>;
    if (raw?.enabled === true && typeof raw.salt === "string" && typeof raw.hash === "string" && typeof raw.secret === "string" && raw.salt && raw.hash && raw.secret) {
      return { enabled: true, salt: raw.salt, hash: raw.hash, secret: raw.secret };
    }
    return PIN_DISABLED;
  } catch {
    return PIN_DISABLED;
  }
}

export async function savePinLock(config: PinLockConfig, base?: string): Promise<void> {
  const file = pinLockFile(base);
  if (!config.enabled) {
    await fsp.rm(file, { force: true });
  } else {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  }
  cached = null;
}

// Short-lived cache so the request gate never reads the disk per hit.
let cached: { at: number; config: PinLockConfig } | null = null;

export async function loadPinLockCached(base?: string): Promise<PinLockConfig> {
  if (cached && Date.now() - cached.at < 5000) return cached.config;
  const config = await loadPinLock(base);
  cached = { at: Date.now(), config };
  return config;
}

export function resetPinLockCache(): void {
  cached = null;
}

// Paths that must stay reachable while locked: the lock screen itself,
// the status/unlock endpoints, the launcher health probe, and Next
// internals (styles/scripts for the lock screen).
export function pinExemptPath(pathname: string): boolean {
  return (
    pathname === "/lock" ||
    pathname.startsWith("/api/security/pin/status") ||
    pathname.startsWith("/api/security/pin/unlock") ||
    pathname.startsWith("/api/health") ||
    // The public status page is guarded by its own bearer token, never by
    // the PIN. Exact matches only — /api/status-page (the admin settings
    // route) stays behind the lock.
    pathname === "/status" ||
    pathname === "/api/status" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}
