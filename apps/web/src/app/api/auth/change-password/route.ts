import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUser } from "@/lib/auth";
import { withDb, hasDatabase } from "@/lib/db";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasDatabase()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.currentPassword || !body?.newPassword) {
    return NextResponse.json({ error: "Both passwords are required" }, { status: 400 });
  }
  if (String(body.newPassword).length < 6) {
    return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
  }

  try {
    const ok = await withDb(async (client) => {
      const res = await client.query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
      if (res.rows.length === 0) return false;
      const valid = await bcrypt.compare(body.currentPassword, res.rows[0].password_hash);
      if (!valid) return false;
      const newHash = await bcrypt.hash(body.newPassword, 10);
      await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);
      return true;
    });

    if (!ok) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[change-password]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
