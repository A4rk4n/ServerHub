import { NextRequest, NextResponse } from "next/server";
import { callerIp, isVisitPath, recordAccess } from "@/lib/access-log";
import { MAX_REQUEST_BYTES, SESSION_COOKIE, requestSizeAllowed, securityHeaders, trustedLocalBoundary, validSession } from "@/lib/local-security";
import { PIN_COOKIE, loadPinLockCached, pinExemptPath, verifyPinToken } from "@/lib/pin-lock";

// Access-log hook: fire-and-forget, deduped in memory, never blocks a
// request and never throws.
function logAccess(request: NextRequest, kind: "visit" | "locked" | "denied") {
  void recordAccess({
    kind,
    ip: callerIp(request.headers.get("x-forwarded-for")),
    userAgent: request.headers.get("user-agent") ?? "",
    path: request.nextUrl.pathname,
  });
}

function secured(response: NextResponse) {
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
}

// The PIN gate sits in front of everything except the lock screen and
// its endpoints: locked API calls get 401 JSON, locked pages redirect
// to /lock. With no PIN configured this is a no-op.
async function pinLockVerdict(request: NextRequest): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  if (pinExemptPath(pathname)) return null;
  const config = await loadPinLockCached();
  if (!config.enabled) return null;
  if (verifyPinToken(request.cookies.get(PIN_COOKIE)?.value, config)) return null;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Server Hub is locked — unlock the panel with your PIN", locked: true }, { status: 401 });
  }
  const destination = request.nextUrl.clone();
  destination.pathname = "/lock";
  destination.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  logAccess(request, "locked");
  return NextResponse.redirect(destination);
}

/** Enforce the native desktop's loopback and per-launch trust boundary. */
export async function proxy(request: NextRequest) {
  if (!trustedLocalBoundary(request.headers.get("host"), request.headers.get("origin"))) {
    logAccess(request, "denied");
    return secured(NextResponse.json({ error: "Server Hub accepts loopback requests only" }, { status: 403 }));
  }
  if (!requestSizeAllowed(request.headers.get("content-length"))) {
    return secured(NextResponse.json({ error: `Request exceeds ${MAX_REQUEST_BYTES} bytes` }, { status: 413 }));
  }

  const pinVerdict = await pinLockVerdict(request);
  if (pinVerdict) return secured(pinVerdict);
  if (request.method === "GET" && isVisitPath(request.nextUrl.pathname)) logAccess(request, "visit");

  const expected = process.env.SERVERHUB_SESSION_TOKEN;
  const bootstrap = request.nextUrl.searchParams.get("serverhub_token") ?? undefined;
  const headerSession = request.headers.get("x-serverhub-session") ?? undefined;
  if (expected && validSession(headerSession, expected)) return secured(NextResponse.next());
  if (expected && validSession(bootstrap, expected)) {
    const destination = request.nextUrl.clone();
    destination.searchParams.delete("serverhub_token");
    const response = NextResponse.redirect(destination);
    response.cookies.set(SESSION_COOKIE, expected, { httpOnly: true, sameSite: "strict", secure: false, path: "/" });
    return secured(response);
  }
  if (!validSession(request.cookies.get(SESSION_COOKIE)?.value, expected)) {
    return secured(NextResponse.json({ error: "Invalid desktop session" }, { status: 401 }));
  }
  return secured(NextResponse.next());
}

export { trustedLocalBoundary } from "@/lib/local-security";
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
