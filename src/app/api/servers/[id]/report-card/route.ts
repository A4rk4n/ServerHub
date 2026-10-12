import { NextResponse } from "next/server";
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { activity, backups, playerSessions, servers } from "@/db/schema";
import { buildReportCard, formatReportCard, REPORT_WINDOW_DAYS, type ReportCard } from "@/lib/report-card";
import { deliverNotification, readNotificationConfig } from "@/lib/notifications";
import { ensureRuntimeInitialized, readUptimeHistory } from "@/lib/runtime";
import { utcDayKey, type DayBucket } from "@/lib/uptime-history";

export const dynamic = "force-dynamic";

const ZERO: DayBucket = { online: 0, maintenance: 0, total: 0 };

async function computeCard(id: string): Promise<ReportCard | null> {
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return null;
  await ensureRuntimeInitialized();
  const now = Date.now();
  const since = new Date(now - REPORT_WINDOW_DAYS * 86_400_000);
  const history = (await readUptimeHistory())[String(server.id)] ?? {};
  const dayBuckets: DayBucket[] = Array.from({ length: REPORT_WINDOW_DAYS }, (_, i) => {
    const key = utcDayKey(new Date(now - i * 86_400_000));
    return history[key] ?? ZERO;
  });
  const activityRows = await db
    .select({ kind: activity.kind })
    .from(activity)
    .where(and(eq(activity.serverId, server.id), gte(activity.ts, since)));
  const backupRows = await db
    .select({ status: backups.status })
    .from(backups)
    .where(and(eq(backups.serverId, server.id), gte(backups.createdAt, since)));
  const sessionRows = await db
    .select({ displayName: playerSessions.displayName, joinedAt: playerSessions.joinedAt, leftAt: playerSessions.leftAt })
    .from(playerSessions)
    .where(and(eq(playerSessions.serverId, server.id), lte(playerSessions.joinedAt, new Date(now)), or(isNull(playerSessions.leftAt), gte(playerSessions.leftAt, since))));
  return buildReportCard({
    serverName: server.name,
    now,
    dayBuckets,
    activityKinds: activityRows.map((r) => r.kind),
    backupStatuses: backupRows.map((r) => r.status),
    sessions: sessionRows.map((r) => ({
      name: r.displayName,
      joinedAt: r.joinedAt instanceof Date ? r.joinedAt.getTime() : Number(r.joinedAt),
      leftAt: r.leftAt === null ? null : r.leftAt instanceof Date ? r.leftAt.getTime() : Number(r.leftAt),
    })),
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const card = await computeCard(id);
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ card });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const card = await computeCard(id);
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const config = await readNotificationConfig();
  if (!config.url) {
    return NextResponse.json({ error: "Notifications are not configured — set a webhook URL on the Tools page first" }, { status: 409 });
  }
  const sent = await deliverNotification(config, { kind: "digest", serverName: card.serverName, detail: formatReportCard(card) });
  if (!sent) return NextResponse.json({ error: "The webhook rejected the report — check the delivery history on the Tools page" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
