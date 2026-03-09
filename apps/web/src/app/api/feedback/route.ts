import { NextRequest, NextResponse } from "next/server";
import { feedbackLog } from "@/lib/feedback";
import { withDb, hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ratings = { relevance: number; tone: number; personality_fit: number };

function isValidRatings(r: unknown): r is Ratings {
  if (!r || typeof r !== "object") return false;
  const obj = r as Record<string, unknown>;
  return (
    typeof obj.relevance === "number" && obj.relevance >= 1 && obj.relevance <= 5 &&
    typeof obj.tone === "number" && obj.tone >= 1 && obj.tone <= 5 &&
    typeof obj.personality_fit === "number" && obj.personality_fit >= 1 && obj.personality_fit <= 5
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "JSON body required" }, { status: 400 });
    }
    const session_id = typeof body.session_id === "string" ? body.session_id.trim() : "";
    if (!session_id) {
      return NextResponse.json({ error: "session_id required" }, { status: 400 });
    }

    const turn_index =
      typeof body.turn_index === "number" && Number.isInteger(body.turn_index) ? body.turn_index : undefined;
    const request_id = typeof body.request_id === "string" ? body.request_id.trim() || undefined : undefined;

    let thumbs_up_down: "up" | "down" | undefined;
    if (body.thumbs_up_down === "up" || body.thumbs_up_down === "down") {
      thumbs_up_down = body.thumbs_up_down;
    }
    let helpfulness_score: number | undefined;
    if (typeof body.helpfulness_score === "number" && body.helpfulness_score >= 0 && body.helpfulness_score <= 5) {
      helpfulness_score = body.helpfulness_score;
    }

    const hasRatings = isValidRatings(body.ratings);
    const ratings = hasRatings ? (body.ratings as Ratings) : undefined;
    const comment = typeof body.comment === "string" ? body.comment.trim() || undefined : undefined;
    const context = body.context && typeof body.context === "object" ? body.context : undefined;

    if (!thumbs_up_down && helpfulness_score === undefined && !hasRatings) {
      return NextResponse.json(
        { error: "At least one of thumbs_up_down, helpfulness_score, or ratings required" },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString();

    // File-based logging (backward compatible)
    feedbackLog({
      session_id,
      turn_index,
      request_id,
      thumbs_up_down,
      helpfulness_score,
      timestamp,
      ...(ratings ? { ratings } : {}),
      ...(comment ? { comment } : {}),
    });

    // Persist structured ratings to PostgreSQL
    if (hasRatings && hasDatabase()) {
      try {
        await withDb(async (client) => {
          await client.query(
            `INSERT INTO human_ratings
              (session_id, turn_index, request_id, relevance, tone, personality_fit, comment, ocean_snapshot, coaching_mode, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (session_id, turn_index) DO UPDATE SET
              relevance = EXCLUDED.relevance,
              tone = EXCLUDED.tone,
              personality_fit = EXCLUDED.personality_fit,
              comment = EXCLUDED.comment,
              ocean_snapshot = EXCLUDED.ocean_snapshot,
              coaching_mode = EXCLUDED.coaching_mode,
              created_at = EXCLUDED.created_at`,
            [
              session_id,
              turn_index ?? null,
              request_id ?? null,
              ratings!.relevance,
              ratings!.tone,
              ratings!.personality_fit,
              comment ?? null,
              context?.ocean ? JSON.stringify(context.ocean) : null,
              context?.coaching_mode ?? null,
              timestamp,
            ]
          );
        });
      } catch (dbErr) {
        console.error("[feedback] DB write failed, logged to file:", dbErr);
      }
    }

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch {
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}
