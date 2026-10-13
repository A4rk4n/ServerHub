import { and, asc, eq, gt, gte, inArray, lte, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { consoleLogs, servers } from "@/db/schema";
import { EXPORT_MAX_LINES, compileMatcher, exportFileName, formatLogLine, normalizeSearchParams } from "@/lib/console-search";

export const dynamic = "force-dynamic";

const BATCH = 1000;

/** Download matching console history as a plain-text .log file (oldest first). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [server] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  const params = normalizeSearchParams({
    q: url.searchParams.get("q"),
    regex: url.searchParams.get("regex"),
    levels: url.searchParams.get("levels"),
    source: url.searchParams.get("source"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  const matcher = compileMatcher(params);
  if (!matcher.ok) return NextResponse.json({ error: matcher.problem }, { status: 400 });

  const pieces: string[] = [];
  let afterId = 0;
  let truncated = false;
  while (pieces.length < EXPORT_MAX_LINES) {
    const conditions: SQL[] = [eq(consoleLogs.serverId, server.id), gt(consoleLogs.id, afterId)];
    if (params.fromMs !== null) conditions.push(gte(consoleLogs.ts, new Date(params.fromMs)));
    if (params.toMs !== null) conditions.push(lte(consoleLogs.ts, new Date(params.toMs)));
    if (params.levels.length > 0) conditions.push(inArray(consoleLogs.level, params.levels));
    const rows = await db.select().from(consoleLogs).where(and(...conditions)).orderBy(asc(consoleLogs.id)).limit(BATCH);
    if (rows.length === 0) break;
    for (const row of rows) {
      afterId = row.id;
      if (!matcher.test(row)) continue;
      pieces.push(formatLogLine({ ts: row.ts ?? new Date(0), level: row.level, source: row.source, message: row.message }));
      if (pieces.length >= EXPORT_MAX_LINES) {
        truncated = true;
        break;
      }
    }
    if (rows.length < BATCH) break;
  }
  if (truncated) pieces.push(`… export truncated at ${EXPORT_MAX_LINES} lines — narrow the date range to fetch the rest.`);
  const body = pieces.join("\n") + (pieces.length ? "\n" : "");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(server.name)}"`,
    },
  });
}
