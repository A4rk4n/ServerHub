import { NextRequest, NextResponse } from "next/server";
import { PIN_COOKIE, loadPinLock, verifyPinToken } from "@/lib/pin-lock";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = await loadPinLock();
  if (!config.enabled) return NextResponse.json({ enabled: false, locked: false });
  return NextResponse.json({ enabled: true, locked: !verifyPinToken(request.cookies.get(PIN_COOKIE)?.value, config) });
}
