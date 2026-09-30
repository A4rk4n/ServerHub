import { NextResponse } from "next/server";
import { readNotificationConfig, validateWebhookUrl, writeNotificationConfig } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ config: await readNotificationConfig() });
}

export async function PUT(request: Request) {
  let body: { url?: unknown; events?: { status?: unknown; crash?: unknown; backup?: unknown } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const problem = validateWebhookUrl(url);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const config = {
    url,
    events: {
      status: body.events?.status !== false,
      crash: body.events?.crash !== false,
      backup: body.events?.backup !== false,
    },
  };
  await writeNotificationConfig(config);
  return NextResponse.json({ config });
}
