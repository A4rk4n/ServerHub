import { collectAuditEvents } from "@/lib/audit-data";
import { AUDIT_EXPORT_MAX_ROWS, auditCsvFileName, filterAuditEvents, normalizeAuditFilters, toAuditCsv } from "@/lib/audit-trail";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filters = normalizeAuditFilters({
    categories: url.searchParams.get("categories"),
    serverId: url.searchParams.get("serverId"),
    q: url.searchParams.get("q"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  const filtered = filterAuditEvents(await collectAuditEvents(), filters).slice(0, AUDIT_EXPORT_MAX_ROWS);
  return new Response(toAuditCsv(filtered), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${auditCsvFileName()}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
