import { NextResponse } from "next/server";
import {
  buildPanelSettingsBundle,
  panelSettingsFileName,
  readPanelSettings,
  verifyPanelSettingsBundle,
  writePanelSettings,
} from "@/lib/panel-settings";
import { APP_VERSION } from "@/lib/update-check";

export const dynamic = "force-dynamic";

export async function GET() {
  const bundle = buildPanelSettingsBundle(await readPanelSettings(), APP_VERSION);
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${panelSettingsFileName()}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  // Malformed JSON must never half-apply a settings import.
  if (raw === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const verdict = verifyPanelSettingsBundle(raw);
  if (!verdict.ok) return NextResponse.json({ error: verdict.problem }, { status: 400 });
  const applied = await writePanelSettings(verdict.bundle.settings);
  if (applied.length === 0) return NextResponse.json({ error: "The bundle contains no settings sections" }, { status: 400 });
  return NextResponse.json({ ok: true, applied, exportedAt: verdict.bundle.exportedAt, appVersion: verdict.bundle.appVersion });
}
