import { timingSafeEqual } from "node:crypto";

export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const SESSION_COOKIE = "serverhub_session";

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

export function requestSizeAllowed(contentLength: string | null) {
  if (!contentLength) return true;
  const value = Number(contentLength);
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_REQUEST_BYTES;
}

export function validSession(candidate: string | undefined, expected: string | undefined) {
  if (!expected) return true; // Browser-independent development and server-only use.
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const securityHeaders = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
} as const;
