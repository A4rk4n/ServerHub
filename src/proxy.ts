import { NextRequest, NextResponse } from "next/server";
import { MAX_REQUEST_BYTES, SESSION_COOKIE, requestSizeAllowed, securityHeaders, trustedLocalBoundary, validSession } from "@/lib/local-security";

function secured(response: NextResponse) {
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
}

/** Enforce the native desktop's loopback and per-launch trust boundary. */
export function proxy(request: NextRequest) {
  if (!trustedLocalBoundary(request.headers.get("host"), request.headers.get("origin"))) {
    return secured(NextResponse.json({ error: "Server Hub accepts loopback requests only" }, { status: 403 }));
  }
  if (!requestSizeAllowed(request.headers.get("content-length"))) {
    return secured(NextResponse.json({ error: `Request exceeds ${MAX_REQUEST_BYTES} bytes` }, { status: 413 }));
  }

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
