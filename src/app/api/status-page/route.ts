// Admin settings for the public status page — PIN-protected like every
// other panel route (only /api/status itself is exempt).
import { NextResponse } from "next/server";
import { DEFAULT_STATUS_TITLE, MAX_STATUS_TITLE_LENGTH, generateStatusToken, normalizeStatusConfig } from "@/lib/status-page";
import { readStatusPageConfig, writeStatusPageConfig } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ config: await readStatusPageConfig() });
}

export async function PUT(req: Request) {
  const raw = await req.json().catch(() => null);
  // Malformed JSON must never silently disable a live status page.
  if (raw === null || typeof raw !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const body = raw as { enabled?: unknown; title?: unknown };
  const current = await readStatusPageConfig();
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, MAX_STATUS_TITLE_LENGTH) : DEFAULT_STATUS_TITLE;
  let token = current.token;
  if (body.enabled === true && !token) token = generateStatusToken();
  const config = normalizeStatusConfig({ enabled: body.enabled === true, token, title });
  await writeStatusPageConfig(config);
  return NextResponse.json({ config });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "regenerate") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const current = await readStatusPageConfig();
  const config = normalizeStatusConfig({ ...current, token: generateStatusToken() });
  await writeStatusPageConfig(config);
  return NextResponse.json({ config });
}
