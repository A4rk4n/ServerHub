import { NextResponse } from "next/server";
import { db } from "@/db";
import { activity } from "@/db/schema";
import { clearAccessLog, describeAgent, loadAccessLog, summarizeAccess } from "@/lib/access-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await loadAccessLog();
  return NextResponse.json({
    entries: entries.map((e) => ({ ...e, agent: describeAgent(e.userAgent) })),
    summary: summarizeAccess(entries),
  });
}

export async function DELETE() {
  await clearAccessLog();
  try {
    await db.insert(activity).values({ serverId: null, kind: "security", message: "Panel access log cleared" });
  } catch { /* best effort */ }
  return NextResponse.json({ ok: true });
}
