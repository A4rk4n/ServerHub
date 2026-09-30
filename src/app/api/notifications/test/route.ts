import { NextResponse } from "next/server";
import { deliverNotification, readNotificationConfig } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = await readNotificationConfig();
  if (!config.url) return NextResponse.json({ error: "No webhook URL is configured" }, { status: 400 });
  const delivered = await deliverNotification(config, { kind: "test", serverName: "Server Hub" });
  if (!delivered) {
    return NextResponse.json({ error: "The webhook did not accept the test notification" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
