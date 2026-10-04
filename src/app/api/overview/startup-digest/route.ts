import { NextResponse } from "next/server";
import { dismissStartupDigest, getStartupDigest } from "@/lib/startup-digest";
import { ensureRuntimeInitialized } from "@/lib/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureRuntimeInitialized();
  const current = getStartupDigest();
  if (!current || !current.show) return NextResponse.json({ digest: null });
  return NextResponse.json({ digest: current.digest });
}

export async function DELETE() {
  dismissStartupDigest();
  return NextResponse.json({ ok: true });
}
