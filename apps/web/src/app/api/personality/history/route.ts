import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { withDb, hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasDatabase()) {
    return NextResponse.json({ history: [] });
  }

  try {
    const history = await withDb(async (client) => {
      const res = await client.query(
        `SELECT ps.session_id, ps.turn_index, ps.ocean_json, ps.confidence_json, ps.stable, ps.created_at
         FROM personality_states ps
         JOIN chat_sessions cs ON cs.session_id = ps.session_id
         WHERE cs.user_id = $1
         ORDER BY ps.created_at ASC
         LIMIT 200`,
        [user.id]
      );
      return res.rows;
    });
    return NextResponse.json({ history });
  } catch (err) {
    console.error("[personality/history]", err);
    return NextResponse.json({ history: [] });
  }
}
