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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }
  if (String(body.password).length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const displayName = body.displayName
    ? String(body.displayName).trim()
    : email.split("@")[0];

  try {
    const passwordHash = await bcrypt.hash(body.password, 10);

    const user = await withDb(async (client) => {
      const existing = await client.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
      );
      if (existing.rows.length > 0) return null;

      const res = await client.query(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ($1, $2, $3) RETURNING id, email, display_name`,
        [email, passwordHash, displayName]
      );
      return res.rows[0];
    });

    if (!user) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const sessionUser = {
      id: user.id,
      email: user.email,
      name: user.display_name ?? email.split("@")[0],
    };
    const token = await createSessionToken(sessionUser);
    const res = NextResponse.json({ success: true, user: sessionUser });
    return setSessionCookieOnResponse(res, token);
  } catch (err) {
    console.error("[register] Error:", err);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
