import { NextResponse } from "next/server";
import { getOverview } from "@/lib/overview-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getOverview());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
