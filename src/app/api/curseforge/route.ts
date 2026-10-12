import { NextResponse } from "next/server";
import { maskApiKey, normalizeCurseforgeKey } from "@/lib/curseforge";
import { readCurseforgeKey, writeCurseforgeKey } from "@/lib/curseforge-key";

export const dynamic = "force-dynamic";

// The key itself never leaves the machine: GET reports only presence
// and a masked tail so the UI can show "configured".
export async function GET() {
  const key = await readCurseforgeKey();
  return NextResponse.json({ configured: key.length > 0, masked: maskApiKey(key) });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const apiKey = normalizeCurseforgeKey((body as { apiKey?: unknown }).apiKey);
  // An empty key is valid — it disconnects CurseForge.
  await writeCurseforgeKey(apiKey);
  return NextResponse.json({ configured: apiKey.length > 0, masked: maskApiKey(apiKey) });
}
