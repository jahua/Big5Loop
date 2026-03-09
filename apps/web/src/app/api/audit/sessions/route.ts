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
                (SELECT COUNT(*) FROM conversation_turns t WHERE t.session_id = s.session_id)::int AS turn_count,
                COALESCE(
                  (SELECT array_agg(DISTINCT t.mode) FROM conversation_turns t WHERE t.session_id = s.session_id AND t.mode IS NOT NULL),
                  ARRAY[]::text[]
                ) AS modes
         FROM chat_sessions s
         WHERE s.user_id = $1
         ORDER BY s.created_at DESC
         LIMIT 100`,
        [user.id]
      );
      return res.rows;
    });
    return NextResponse.json({ sessions });
  } catch (err) {
    console.error("[audit/sessions]", err);
    return NextResponse.json({ sessions: [] });
  }
}
