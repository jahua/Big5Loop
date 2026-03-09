import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { withDb, hasDatabase } from "@/lib/db";
import { createSessionToken, setSessionCookieOnResponse } from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const email = String(body.email).toLowerCase().trim();

  try {
    const user = await withDb(async (client) => {
      const res = await client.query(
        "SELECT id, email, password_hash, display_name FROM users WHERE email = $1",
        [email]
      );
      return res.rows[0] ?? null;
    });

    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const sessionUser = {
      id: user.id,
      email: user.email,
      name: user.display_name ?? user.email.split("@")[0],
    };
    const token = await createSessionToken(sessionUser);
    const res = NextResponse.json({ success: true, user: sessionUser });
    return setSessionCookieOnResponse(res, token);
  } catch (err) {
    console.error("[login] Error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
