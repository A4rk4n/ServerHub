import { NextResponse } from "next/server";
import { collectAuditEvents } from "@/lib/audit-data";
import { filterAuditEvents, normalizeAuditFilters, paginateAuditEvents } from "@/lib/audit-trail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filters = normalizeAuditFilters({
    categories: url.searchParams.get("categories"),
    serverId: url.searchParams.get("serverId"),
    q: url.searchParams.get("q"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
  const filtered = filterAuditEvents(await collectAuditEvents(), filters);
  const page = paginateAuditEvents(filtered, filters);
  return NextResponse.json({ events: page.events, total: page.total, offset: filters.offset, limit: filters.limit });
}
