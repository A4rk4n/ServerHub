import { db } from "@/db";
import { servers } from "@/db/schema";
import { ensureRuntimeInitialized } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureRuntimeInitialized();
    await db.select({ id: servers.id }).from(servers).limit(1);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
