import { NextResponse } from "next/server";
import { normalizeDiskAlertConfig } from "@/lib/disk-alerts";
import { getDiskAlertStatus, readDiskAlertConfig, sweepDiskAlerts, writeDiskAlertConfig } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readDiskAlertConfig();
  return NextResponse.json({ config, status: getDiskAlertStatus() });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  // Malformed JSON must never silently reset the thresholds to defaults.
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const config = normalizeDiskAlertConfig(body);
  await writeDiskAlertConfig(config);
  return NextResponse.json({ config, status: getDiskAlertStatus() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "check-now") {
    const result = await sweepDiskAlerts(Date.now(), true);
    return NextResponse.json({ ok: true, ...result, status: getDiskAlertStatus() });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
