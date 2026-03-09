import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, createSessionToken, setSessionCookieOnResponse } from "@/lib/auth";
import { withDb, hasDatabase } from "@/lib/db";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasDatabase()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const displayName = body?.displayName ? String(body.displayName).trim() : null;
  if (!displayName) {
    return NextResponse.json({ error: "Display name is required" }, { status: 400 });
  }

  try {
    await withDb(async (client) => {
      await client.query("UPDATE users SET display_name = $1 WHERE id = $2", [displayName, user.id]);
    });
    const updated = { ...user, name: displayName };
    const token = await createSessionToken(updated);
    const res = NextResponse.json({ success: true, user: updated });
    return setSessionCookieOnResponse(res, token);
  } catch (err) {
    console.error("[update-profile]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
