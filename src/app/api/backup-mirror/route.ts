import { NextResponse } from "next/server";
import { normalizeMirrorConfig, validateMirrorDirectory } from "@/lib/backup-mirror";
import { backupMirrorStatus, syncBackupMirror, writeMirrorConfig } from "@/lib/runtime";
import { appDataDir } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await backupMirrorStatus();
  return NextResponse.json(status);
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const config = normalizeMirrorConfig(body);
  const wantsEnabled = !!body && typeof body === "object" && (body as Record<string, unknown>).enabled === true;
  if (wantsEnabled || config.directory) {
    const problem = validateMirrorDirectory(config.directory, appDataDir());
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }
  await writeMirrorConfig(config);
  const status = await backupMirrorStatus();
  return NextResponse.json(status);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "sync") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const result = await syncBackupMirror();
  return NextResponse.json(result, { status: result.ok || result.reason ? 200 : 500 });
}
