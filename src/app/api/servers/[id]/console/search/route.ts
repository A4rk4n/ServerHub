import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lt, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { consoleLogs, servers } from "@/db/schema";
import { MAX_SCAN_ROWS, collectMatches, compileMatcher, normalizeSearchParams } from "@/lib/console-search";

export const dynamic = "force-dynamic";

const BATCH = 500;

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
    limit: url.searchParams.get("limit"),
    cursor: url.searchParams.get("cursor"),
  });
  const matcher = compileMatcher(params);
  if (!matcher.ok) return NextResponse.json({ error: matcher.problem }, { status: 400 });

  const matched: Array<{ id: number; ts: Date | null; level: string; source: string; message: string }> = [];
  let cursor = params.cursor;
  let scanned = 0;
  let exhausted = false; // no more rows in range
  let budgetSpent = false;

  while (matched.length < params.limit && scanned < MAX_SCAN_ROWS) {
    const conditions: SQL[] = [eq(consoleLogs.serverId, server.id)];
    if (cursor !== null) conditions.push(lt(consoleLogs.id, cursor));
    if (params.fromMs !== null) conditions.push(gte(consoleLogs.ts, new Date(params.fromMs)));
    if (params.toMs !== null) conditions.push(lte(consoleLogs.ts, new Date(params.toMs)));
    if (params.levels.length > 0) conditions.push(inArray(consoleLogs.level, params.levels));
    const rows = await db.select().from(consoleLogs).where(and(...conditions)).orderBy(desc(consoleLogs.id)).limit(BATCH);
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    const page = collectMatches(rows, matcher, params.limit - matched.length, MAX_SCAN_ROWS - scanned);
    matched.push(...page.matched);
    scanned += page.scanned;
    if (page.lastExaminedId !== null) cursor = page.lastExaminedId;
    if (page.exhaustedBudget) {
      budgetSpent = true;
      break;
    }
    if (rows.length < BATCH && page.scanned >= rows.length) {
      exhausted = true;
      break;
    }
  }

  return NextResponse.json({
    lines: matched.map((line) => ({ id: line.id, ts: line.ts, level: line.level, source: line.source, message: line.message })),
    nextCursor: exhausted ? null : cursor,
    scanned,
    scanTruncated: budgetSpent,
  });
}
