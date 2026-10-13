// Unit suite for the panel PIN lock: PIN format and scrypt
// verification, stateless HMAC unlock tokens (expiry, tamper, secret
// rotation), the brute-force throttle, 0600 persistence with
// corrupt-file fallback, exempt paths, and the proxy/API/UI wiring.

import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PIN_DISABLED,
  PIN_LOCKOUT_MS,
  PIN_MAX_ATTEMPTS,
  attemptBlocked,
  createPinConfig,
  issuePinToken,
  loadPinLock,
  nextAttemptState,
  pinExemptPath,
  pinLockFile,
  savePinLock,
  validPinFormat,
  verifyPin,
  verifyPinToken,
} from "../src/lib/pin-lock";

test("PINs are 4-12 digits and verify through salted scrypt", () => {
  for (const good of ["1234", "000000", "123456789012"]) assert.ok(validPinFormat(good), `${good} is valid`);
  for (const bad of ["123", "1234567890123", "12a4", "12 34", "", null, 1234]) assert.ok(!validPinFormat(bad as string), `${JSON.stringify(bad)} is invalid`);
  const config = createPinConfig("4812");
  assert.ok(config.enabled && config.salt.length === 32 && config.hash.length === 64 && config.secret.length === 64);
  assert.ok(verifyPin("4812", config));
  assert.ok(!verifyPin("4813", config), "a wrong PIN never verifies");
  assert.ok(!verifyPin("4812", PIN_DISABLED), "a disabled config verifies nothing");
  assert.notEqual(createPinConfig("4812").hash, config.hash, "salts make every hash unique");
});

test("unlock tokens expire, resist tampering, and die on secret rotation", () => {
  const config = createPinConfig("2468");
  const now = 1_800_000_000_000;
  const token = issuePinToken(config, now);
  assert.ok(verifyPinToken(token, config, now + 1000));
  assert.ok(verifyPinToken(token, config, now + 11 * 60 * 60 * 1000), "tokens last 12 hours");
  assert.ok(!verifyPinToken(token, config, now + 13 * 60 * 60 * 1000), "expired tokens fail");
  const [expires] = token.split(".");
  assert.ok(!verifyPinToken(`${Number(expires) + 60_000}.${token.split(".")[1]}`, config, now), "extending the expiry breaks the signature");
  assert.ok(!verifyPinToken(token.slice(0, -2) + "zz", config, now), "a tampered signature fails");
  const rotated = createPinConfig("2468");
  assert.ok(!verifyPinToken(token, rotated, now), "changing the PIN rotates the secret and kills old tokens");
  assert.ok(!verifyPinToken(token, PIN_DISABLED, now));
});

test("five wrong PINs lock attempts out for 30 seconds; success resets", () => {
  const now = 1_800_000_000_000;
  let state = undefined as ReturnType<typeof nextAttemptState> | undefined;
  for (let i = 0; i < PIN_MAX_ATTEMPTS - 1; i++) {
    state = nextAttemptState(state, false, now);
    assert.equal(attemptBlocked(state, now), 0, `attempt ${i + 1} does not block yet`);
  }
  state = nextAttemptState(state, false, now);
  assert.equal(attemptBlocked(state, now), PIN_LOCKOUT_MS, "the fifth failure blocks for 30s");
  assert.equal(attemptBlocked(state, now + PIN_LOCKOUT_MS), 0, "the block expires");
  state = nextAttemptState(state, false, now + PIN_LOCKOUT_MS);
  assert.ok(attemptBlocked(state, now + PIN_LOCKOUT_MS) > 0, "failing again after the window re-locks immediately");
  state = nextAttemptState(state, true, now + 2 * PIN_LOCKOUT_MS);
  assert.deepEqual(state, { failures: 0, lockedUntil: 0 }, "a correct PIN resets everything");
});

test("the config persists at 0600, corrupt files fail closed to disabled", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hub-pin-"));
  const config = createPinConfig("9876");
  await savePinLock(config, base);
  const mode = (await fsp.stat(pinLockFile(base))).mode & 0o777;
  if (process.platform !== "win32") assert.equal(mode, 0o600, "the PIN file is owner-only");
  const loaded = await loadPinLock(base);
  assert.deepEqual(loaded, config);
  await fsp.writeFile(pinLockFile(base), "{nope", "utf8");
  assert.deepEqual(await loadPinLock(base), PIN_DISABLED, "corrupt files disable the lock instead of bricking the panel");
  await savePinLock(PIN_DISABLED, base);
  assert.ok(!fs.existsSync(pinLockFile(base)), "disabling removes the file");
  await fsp.rm(base, { recursive: true, force: true });
});

test("exempt paths keep the lock screen and launcher reachable; everything else is gated", () => {
  for (const open of ["/lock", "/api/security/pin/unlock", "/api/security/pin/status", "/api/health", "/_next/whatever", "/favicon.ico", "/status", "/api/status"]) {
    assert.ok(pinExemptPath(open), `${open} stays reachable while locked`);
  }
  for (const gated of ["/", "/servers/1", "/tools", "/api/servers", "/api/security/pin", "/api/servers/1/backups", "/api/status-page", "/status-admin"]) {
    assert.ok(!pinExemptPath(gated), `${gated} is gated`);
  }
});

test("the proxy, API routes, lock screen, and settings panel are wired", () => {
  const proxy = fs.readFileSync("src/proxy.ts", "utf8");
  assert.ok(proxy.includes("pinLockVerdict"), "the proxy evaluates the PIN gate");
  assert.ok(proxy.indexOf("pinVerdict") < proxy.indexOf("SERVERHUB_SESSION_TOKEN"), "the PIN gate runs before the desktop session logic");
  assert.ok(proxy.includes('destination.pathname = "/lock"'), "locked pages redirect to the lock screen");
  assert.ok(proxy.includes("locked: true"), "locked API calls answer 401 JSON");
  const unlock = fs.readFileSync("src/app/api/security/pin/unlock/route.ts", "utf8");
  assert.ok(unlock.includes("attemptBlocked") && unlock.includes("nextAttemptState"), "unlocking is brute-force throttled");
  const manage = fs.readFileSync("src/app/api/security/pin/route.ts", "utf8");
  assert.ok(manage.includes("The current PIN is not correct"), "changing or removing the PIN requires the current one");
  const page = fs.readFileSync("src/app/lock/page.tsx", "utf8");
  assert.ok(page.includes("Server Hub is locked"), "the lock screen exists");
  assert.ok(page.includes("pin-lock.json"), "the recovery hint is on the lock screen");
  const panel = fs.readFileSync("src/components/pin-lock-panel.tsx", "utf8");
  assert.ok(panel.includes("Lock now"), "the panel can lock immediately");
  const tools = fs.readFileSync("src/app/tools/page.tsx", "utf8");
  assert.ok(tools.includes("PinLockPanel"), "the Tools page hosts the PIN panel");
  console.log("PIN_LOCK_SUITE_OK");
});
