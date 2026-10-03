import { NextResponse } from "next/server";
import { summarizeDeliveries } from "@/lib/notification-history";
import { readDeliveryHistory } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const deliveries = await readDeliveryHistory();
  return NextResponse.json({ deliveries, summary: summarizeDeliveries(deliveries) });
}
