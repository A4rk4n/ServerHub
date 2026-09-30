import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { BULK_LIMIT, BULK_ACTIONS, type BulkAction, partitionBulkAction, startDelaysMs } from "@/lib/bulk-power";
import { restartFlow, startFlow, stopFlow } from "@/lib/runtime";

export const dynamic = "force-dynamic";

type Outcome = { id: number; name: string; outcome: "ok" | "failed" | "scheduled" | "skipped"; reason?: string };

export async function POST(request: Request) {
  let body: { action?: unknown; ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body.action as BulkAction;
  if (!BULK_ACTIONS.includes(action)) return NextResponse.json({ error: "Unknown bulk action" }, { status: 400 });
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id) => Number.isInteger(id)))] as number[] : [];
  if (ids.length === 0) return NextResponse.json({ error: "No servers selected" }, { status: 400 });
  if (ids.length > BULK_LIMIT) return NextResponse.json({ error: `At most ${BULK_LIMIT} servers per request` }, { status: 400 });

  const rows = await db.select().from(servers).where(inArray(servers.id, ids));
  const { eligible, skipped } = partitionBulkAction(rows, action);
  const results: Outcome[] = skipped.map((s) => ({ id: s.id, name: s.name, outcome: "skipped", reason: `status is ${s.status}` }));

  if (action === "start") {
    // Staggered fire-and-forget: respond immediately, pace the actual
    // starts so a fleet launch cannot spike CPU/disk, and let the UI's
    // existing status polling show each server coming up.
    const delays = startDelaysMs(eligible.length);
    eligible.forEach((server, index) => {
      const timer = setTimeout(() => void startFlow(server.id).catch(() => {}), delays[index]);
      timer.unref?.();
      results.push({ id: server.id, name: server.name, outcome: "scheduled", reason: delays[index] ? `starts in ${delays[index] / 1000}s` : undefined });
    });
  } else {
    const flow = action === "stop" ? stopFlow : restartFlow;
    const settled = await Promise.allSettled(eligible.map((server) => flow(server.id)));
    settled.forEach((outcome, index) => {
      const server = eligible[index];
      if (outcome.status === "fulfilled" && outcome.value.ok) results.push({ id: server.id, name: server.name, outcome: "ok" });
      else {
        const reason = outcome.status === "fulfilled" ? outcome.value.reason : String(outcome.reason);
        results.push({ id: server.id, name: server.name, outcome: "failed", reason });
      }
    });
  }
  results.sort((a, b) => a.id - b.id);
  return NextResponse.json({ action, results });
}
