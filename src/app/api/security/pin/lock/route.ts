import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// "Lock now": drops this browser's unlock cookie. The stateless token
// it held simply stops being presented; walking away is instant.
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("serverhub_pin");
  return response;
}
