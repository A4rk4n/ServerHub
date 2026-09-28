import { NextRequest, NextResponse } from "next/server";

function localHostname(value: string) {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function trustedLocalBoundary(hostHeader: string | null, originHeader: string | null) {
  if (!hostHeader) return false;
  let host: URL;
  try { host = new URL(`http://${hostHeader}`); } catch { return false; }
  if (!localHostname(host.hostname)) return false;
  if (!originHeader || originHeader === "null") return true;
  let origin: URL;
  try { origin = new URL(originHeader); } catch { return false; }
  return (origin.protocol === "http:" || origin.protocol === "https:") && localHostname(origin.hostname) && origin.port === host.port;
}

/** Enforce the local desktop trust boundary before any page or API route runs. */
export function proxy(request: NextRequest) {
  if (!trustedLocalBoundary(request.headers.get("host"), request.headers.get("origin"))) {
    return NextResponse.json({ error: "Server Hub accepts loopback requests only" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
