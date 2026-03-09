import { NextResponse } from "next/server";
import { clearSessionCookieOnResponse } from "@/lib/auth";

export async function POST() {
  const res = NextResponse.json({ success: true });
  return clearSessionCookieOnResponse(res);
}
