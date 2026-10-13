import { NextResponse } from "next/server";
import { sendActivityDigest } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/** Send the activity digest immediately, regardless of schedule. */
export async function POST() {
  const result = await sendActivityDigest(true);
  return NextResponse.json(result, { status: result.sent ? 200 : 409 });
}
