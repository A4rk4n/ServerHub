import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { activity } from "@/db/schema";
import {
  PIN_COOKIE,
  PIN_MAX_ATTEMPTS,
  PIN_TOKEN_TTL_MS,
  attemptBlocked,
  issuePinToken,
  loadPinLock,
  nextAttemptState,
  verifyPin,
  type PinAttemptState,
} from "@/lib/pin-lock";

export const dynamic = "force-dynamic";

// Brute-force throttle: all unlock attempts funnel through this one
// route, so in-process state is authoritative. Five straight failures
// lock attempts out for 30 seconds.
let attempts: PinAttemptState = { failures: 0, lockedUntil: 0 };

// Audit-trail record; never allowed to break an unlock.
async function recordAttempt(message: string): Promise<void> {
  try {
    await db.insert(activity).values({ serverId: null, kind: "security", message });
  } catch { /* best effort */ }
}

export async function POST(request: NextRequest) {
  const config = await loadPinLock();
  if (!config.enabled) return NextResponse.json({ ok: true, enabled: false });
  const blockedMs = attemptBlocked(attempts);
  if (blockedMs > 0) {
    await recordAttempt("PIN unlock attempt while throttled");
    return NextResponse.json({ error: "Too many wrong PINs — wait before trying again", retryInMs: blockedMs }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { pin?: string } | null;
  const ok = verifyPin(body?.pin, config);
  attempts = nextAttemptState(attempts, ok);
  if (!ok) {
    const blocked = attemptBlocked(attempts);
    await recordAttempt(blocked > 0 ? `PIN unlock failed — attempt limit reached, throttled for ${Math.ceil(blocked / 1000)}s` : `PIN unlock failed (${Math.max(0, PIN_MAX_ATTEMPTS - attempts.failures)} attempts left)`);
    return NextResponse.json(
      blocked > 0
        ? { error: "Too many wrong PINs — wait before trying again", retryInMs: blocked }
        : { error: "Wrong PIN", attemptsLeft: Math.max(0, PIN_MAX_ATTEMPTS - attempts.failures) },
      { status: blocked > 0 ? 429 : 401 }
    );
  }
  await recordAttempt("PIN unlock succeeded");
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PIN_COOKIE, issuePinToken(config), { httpOnly: true, sameSite: "strict", secure: false, path: "/", maxAge: Math.floor(PIN_TOKEN_TTL_MS / 1000) });
  return response;
}
