import { NextResponse } from "next/server";
import { normalizeLogRetentionConfig } from "@/lib/log-retention";
import { getLogRetentionStatus, readLogRetentionConfig, sweepLogRetention, writeLogRetentionConfig } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readLogRetentionConfig();
  return NextResponse.json({ config, status: getLogRetentionStatus() });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  // Malformed JSON must never silently reset the retention window.
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const config = normalizeLogRetentionConfig(body);
  await writeLogRetentionConfig(config);
  return NextResponse.json({ config, status: getLogRetentionStatus() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "sweep-now") {
    const result = await sweepLogRetention(Date.now(), true);
    return NextResponse.json({ ok: true, ...result, status: getLogRetentionStatus() });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
