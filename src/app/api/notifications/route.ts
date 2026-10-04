import { NextResponse } from "next/server";
import { normalizeDigestConfig } from "@/lib/digest";
import { WEBHOOK_FORMATS, readNotificationConfig, validateWebhookUrl, writeNotificationConfig, type WebhookFormat } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readNotificationConfig();
  return NextResponse.json({ config: { ...config, digest: normalizeDigestConfig(config.digest) } });
}

export async function PUT(request: Request) {
  let body: { url?: unknown; events?: { status?: unknown; crash?: unknown; backup?: unknown }; digest?: unknown; format?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const problem = validateWebhookUrl(url);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (body.format !== undefined && (typeof body.format !== "string" || !WEBHOOK_FORMATS.includes(body.format as WebhookFormat))) {
    return NextResponse.json({ error: "format must be one of auto, discord, slack, json" }, { status: 400 });
  }
  const format = body.format as WebhookFormat | undefined;
  const config = {
    url,
    events: {
      status: body.events?.status !== false,
      crash: body.events?.crash !== false,
      backup: body.events?.backup !== false,
    },
    digest: normalizeDigestConfig(body.digest),
    // "auto" is the default — never persist it explicitly.
    ...(format && format !== "auto" ? { format } : {}),
  };
  await writeNotificationConfig(config);
  return NextResponse.json({ config });
}
