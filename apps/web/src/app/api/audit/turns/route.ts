import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { withDb, hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasDatabase()) {
    return NextResponse.json({ turns: [] });
  }

  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ turns: [] }, { status: 400 });
  }

  try {
    const turns = await withDb(async (client) => {
      const res = await client.query(
        `SELECT t.turn_index, t.user_msg, t.assistant_msg, t.mode, t.latency_ms, t.created_at
         FROM conversation_turns t
         JOIN chat_sessions s ON s.session_id = t.session_id
         WHERE t.session_id = $1 AND s.user_id = $2
         ORDER BY t.turn_index ASC`,
        [sessionId, user.id]
      );
      return res.rows;
    });
    return NextResponse.json({ turns });
  } catch (err) {
    console.error("[audit/turns]", err);
    return NextResponse.json({ turns: [] });
  }
}
