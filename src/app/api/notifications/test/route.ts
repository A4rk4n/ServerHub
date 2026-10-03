import { NextResponse } from "next/server";
import { deliverAndRecord, readNotificationConfig } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = await readNotificationConfig();
  if (!config.url) return NextResponse.json({ error: "No webhook URL is configured" }, { status: 400 });
  const outcome = await deliverAndRecord(config, { kind: "test", serverName: "Server Hub" });
  if (!outcome.sent) {
    const reason = outcome.status > 0
      ? `The webhook answered HTTP ${outcome.status}`
      : `The webhook could not be reached${outcome.error ? ` (${outcome.error})` : ""}`;
    return NextResponse.json({ error: `${reason} — see Recent deliveries for details.`, status: outcome.status }, { status: 502 });
  }
  return NextResponse.json({ ok: true, status: outcome.status, durationMs: outcome.durationMs });
}
