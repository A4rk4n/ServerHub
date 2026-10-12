import { NextResponse } from "next/server";
import { normalizeAddonSweepConfig } from "@/lib/addon-update-sweep";
import { getAddonSweepStatus, readAddonSweepConfig, sweepAddonUpdates, writeAddonSweepConfig } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readAddonSweepConfig();
  return NextResponse.json({ config, status: await getAddonSweepStatus() });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  // Malformed JSON must never silently flip the sweep on or off.
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const config = normalizeAddonSweepConfig(body);
  await writeAddonSweepConfig(config);
  return NextResponse.json({ config, status: await getAddonSweepStatus() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "sweep-now") {
    const result = await sweepAddonUpdates(Date.now(), true);
    return NextResponse.json({ ok: true, ...result, status: await getAddonSweepStatus() });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
