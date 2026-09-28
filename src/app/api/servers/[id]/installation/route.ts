import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { installationEvents, installationJobs, servers } from "@/db/schema";
import { cancelInstallation, ensureRuntimeInitialized, installFlow } from "@/lib/runtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function serverId(ctx: Ctx) {
  const { id } = await ctx.params;
  const value = Number(id);
  if (!Number.isInteger(value) || value < 1) return null;
  const [server] = await db.select({ id: servers.id }).from(servers).where(eq(servers.id, value));
  return server?.id ?? null;
}

export async function GET(_req: Request, ctx: Ctx) {
  await ensureRuntimeInitialized();
  const id = await serverId(ctx);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [job] = await db
    .select()
    .from(installationJobs)
    .where(eq(installationJobs.serverId, id))
    .orderBy(desc(installationJobs.id))
    .limit(1);
  if (!job) return NextResponse.json({ job: null, events: [] });

  const events = await db
    .select()
    .from(installationEvents)
    .where(and(eq(installationEvents.serverId, id), eq(installationEvents.jobId, job.id)))
    .orderBy(desc(installationEvents.id))
    .limit(12);

  return NextResponse.json({ job, events: events.reverse() });
}

export async function POST(req: Request, ctx: Ctx) {
  const id = await serverId(ctx);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === "cancel") {
    const result = await cancelInstallation(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  if (body.action === "retry") {
    const result = await installFlow(id);
    return NextResponse.json(result, { status: result.ok ? 202 : 409 });
  }

  const active = await db
    .select({ id: installationJobs.id })
    .from(installationJobs)
    .where(and(eq(installationJobs.serverId, id), inArray(installationJobs.status, ["queued", "running", "cancelling"])))
    .limit(1);
  return NextResponse.json(
    { error: active.length ? "Use the cancel action for the active installation" : "Unknown installation action" },
    { status: 400 }
  );
}
