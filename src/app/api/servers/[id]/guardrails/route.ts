import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { DEFAULT_GUARDRAIL_CONFIG, loadGuardrails, normalizeGuardrailConfig, saveGuardrails } from "@/lib/guardrails";
import { guardrailActive } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const all = await loadGuardrails();
  return NextResponse.json({ config: all[String(server.id)] ?? DEFAULT_GUARDRAIL_CONFIG, active: guardrailActive(server.id) });
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return NextResponse.json({ error: "Invalid guardrail configuration" }, { status: 400 });
  const config = normalizeGuardrailConfig(body);
  if (config.enabled && !config.cpuPct && !config.ramMb) {
    return NextResponse.json({ error: "Enable at least one threshold (CPU or RAM) for the guardrail" }, { status: 400 });
  }
  const all = await loadGuardrails();
  all[String(server.id)] = config;
  await saveGuardrails(all);
  return NextResponse.json({ config, active: guardrailActive(server.id) });
}
