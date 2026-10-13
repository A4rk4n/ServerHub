import { NextRequest, NextResponse } from "next/server";
import {
  PIN_COOKIE,
  PIN_TOKEN_TTL_MS,
  createPinConfig,
  issuePinToken,
  loadPinLock,
  savePinLock,
  validPinFormat,
  verifyPin,
  PIN_DISABLED,
} from "@/lib/pin-lock";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadPinLock();
  return NextResponse.json({ enabled: config.enabled });
}

// Sets or changes the PIN. When a PIN already exists the current one
// must verify first; either way the signing secret rotates, so every
// previously issued unlock token dies immediately.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { currentPin?: string; newPin?: string } | null;
  const config = await loadPinLock();
  if (config.enabled && !verifyPin(body?.currentPin, config)) {
    return NextResponse.json({ error: "The current PIN is not correct" }, { status: 401 });
  }
  if (!validPinFormat(body?.newPin)) {
    return NextResponse.json({ error: "A PIN is 4 to 12 digits" }, { status: 400 });
  }
  const next = createPinConfig(body!.newPin!);
  await savePinLock(next);
  const response = NextResponse.json({ ok: true, enabled: true });
  response.cookies.set(PIN_COOKIE, issuePinToken(next), { httpOnly: true, sameSite: "strict", secure: false, path: "/", maxAge: Math.floor(PIN_TOKEN_TTL_MS / 1000) });
  return response;
}

// Disables the PIN — requires the current PIN.
export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { currentPin?: string } | null;
  const config = await loadPinLock();
  if (!config.enabled) return NextResponse.json({ ok: true, enabled: false });
  if (!verifyPin(body?.currentPin, config)) {
    return NextResponse.json({ error: "The current PIN is not correct" }, { status: 401 });
  }
  await savePinLock(PIN_DISABLED);
  const response = NextResponse.json({ ok: true, enabled: false });
  response.cookies.delete(PIN_COOKIE);
  return response;
}
