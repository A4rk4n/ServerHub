import fsp from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { addons, servers } from "@/db/schema";
import { planAddonCopy, validateCopyPair } from "@/lib/addon-copy";
import { act, logLine } from "@/lib/runtime";
import { safePath, serverDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

// POST { fromServerId } — copy the source server's mods onto this one.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [target] = await db.select().from(servers).where(eq(servers.id, Number(id)));
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let fromServerId = 0;
  try {
    const body = (await req.json()) as { fromServerId?: unknown };
    fromServerId = Number(body.fromServerId);
  } catch {
    // falls through to the validation below
  }
  if (!Number.isInteger(fromServerId) || fromServerId <= 0) {
    return NextResponse.json({ error: "Expected `fromServerId`" }, { status: 400 });
  }
  const [source] = await db.select().from(servers).where(eq(servers.id, fromServerId));
  if (!source) return NextResponse.json({ error: "Source server not found" }, { status: 404 });

  const pairProblem = validateCopyPair(source, target);
  if (pairProblem) return NextResponse.json({ error: pairProblem }, { status: 400 });

  const sourceRows = await db.select().from(addons).where(eq(addons.serverId, source.id));
  const targetRows = await db.select().from(addons).where(eq(addons.serverId, target.id));
  const plan = planAddonCopy(sourceRows, targetRows);

  const copied: string[] = [];
  const skipped = [...plan.skipped];
  for (const addon of plan.copy) {
    const from = safePath(serverDir(source), addon.filePath);
    const to = safePath(serverDir(target), addon.filePath);
    if (!from || !to) {
      skipped.push({ name: addon.name, reason: "unsafe file path" });
      continue;
    }
    const stat = await fsp.stat(from).catch(() => null);
    if (!stat) {
      skipped.push({ name: addon.name, reason: "file missing on the source server" });
      continue;
    }
    await fsp.mkdir(path.dirname(to), { recursive: true });
    // Copy → rename so the target's mods folder never sees a partial jar.
    await fsp.copyFile(from, `${to}.copying`);
    await fsp.rename(`${to}.copying`, to);
    await db.insert(addons).values({
      serverId: target.id,
      name: addon.name,
      version: addon.version,
      author: addon.author,
      source: addon.source,
      summary: addon.summary,
      downloads: addon.downloads,
      projectId: addon.projectId,
      filePath: addon.filePath,
      enabled: addon.enabled,
    });
    copied.push(addon.name);
  }

  if (copied.length > 0) {
    await logLine(target.id, "success", "Mods", `Copied ${copied.length} mod${copied.length === 1 ? "" : "s"} from ${source.name}: ${copied.join(", ")}.`);
    await act(target.id, "addon", `${copied.length} mod${copied.length === 1 ? "" : "s"} copied from ${source.name} to ${target.name}`);
  }
  return NextResponse.json({ copied, skipped });
}
