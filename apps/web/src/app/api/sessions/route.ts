import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { withDb, hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasDatabase()) {
    return NextResponse.json({ sessions: [] });
  }

  try {
    const sessions = await withDb(async (client) => {
      const res = await client.query(
        `SELECT s.session_id, s.created_at, s.status,
                (SELECT COUNT(*) FROM conversation_turns t WHERE t.session_id = s.session_id) AS turn_count,
                (SELECT user_msg FROM conversation_turns t WHERE t.session_id = s.session_id ORDER BY turn_index LIMIT 1) AS first_message
         FROM chat_sessions s
         WHERE s.user_id = $1
         ORDER BY s.created_at DESC
         LIMIT 50`,
        [user.id]
      );
      return res.rows;
    });

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.session_id,
        label: s.first_message
          ? String(s.first_message).slice(0, 60)
          : "New conversation",
        messageCount: Number(s.turn_count) * 2,
        lastUsed: s.created_at,
      })),
    });
  } catch (err) {
    console.error("[sessions] Error:", err);
    return NextResponse.json({ sessions: [] });
  }
}
