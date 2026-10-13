// Public, token-guarded, read-only. This route is exempt from the PIN
// lock — the bearer token in the query string is its only guard, and the
// response is whitelist-built so nothing sensitive can appear in it.
import { NextResponse } from "next/server";
import { statusAccess } from "@/lib/status-page";
import { getPublicStatusSnapshot, readStatusPageConfig } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const config = await readStatusPageConfig();
  const url = new URL(req.url);
  const access = statusAccess(config, url.searchParams.get("token") ?? "");
  if (!access.ok) return NextResponse.json({ error: access.problem }, { status: access.status });
  return NextResponse.json(await getPublicStatusSnapshot());
}
