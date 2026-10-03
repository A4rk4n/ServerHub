// Server-side collector for the audit trail: pulls bounded newest-first
// slices of each source table and merges them through the pure module.
// Shared by the JSON endpoint and the CSV export.

import { desc } from "drizzle-orm";
import { db } from "@/db";
import { activity, moderationActions, servers, taskRuns } from "@/db/schema";
import { AUDIT_SOURCE_ROWS, buildAuditEvents, type AuditEvent } from "./audit-trail";

export async function collectAuditEvents(): Promise<AuditEvent[]> {
  const [activityRows, taskRows, moderationRows, fleet] = await Promise.all([
    db.select().from(activity).orderBy(desc(activity.id)).limit(AUDIT_SOURCE_ROWS),
    db.select().from(taskRuns).orderBy(desc(taskRuns.id)).limit(AUDIT_SOURCE_ROWS),
    db.select().from(moderationActions).orderBy(desc(moderationActions.id)).limit(AUDIT_SOURCE_ROWS),
    db.select({ id: servers.id, name: servers.name }).from(servers),
  ]);
  return buildAuditEvents({
    activity: activityRows,
    taskRuns: taskRows,
    moderation: moderationRows,
    serverNames: new Map(fleet.map((row) => [row.id, row.name])),
  });
}
