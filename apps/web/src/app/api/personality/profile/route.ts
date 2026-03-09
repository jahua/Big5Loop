import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { withDb, hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasDatabase()) {
    return NextResponse.json({ profile: null });
  }

  try {
    const profile = await withDb(async (client) => {
      const res = await client.query(
        "SELECT ocean_scores, confidence, total_turns, stable FROM user_personality_profiles WHERE user_id = $1",
        [user.id]
      );
      return res.rows[0] ?? null;
    });
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("[personality/profile GET]", err);
    return NextResponse.json({ profile: null });
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasDatabase()) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const newOcean = body?.ocean;
  const newConfidence = body?.confidence;
  if (!newOcean || typeof newOcean !== "object") {
    return NextResponse.json({ error: "Missing ocean scores" }, { status: 400 });
  }

  const CROSS_SESSION_ALPHA = 0.2;
  const STABILITY_MIN_TURNS = 20;
  const STABILITY_VARIANCE = 0.03;

  try {
    const profile = await withDb(async (client) => {
      const existing = await client.query(
        "SELECT ocean_scores, confidence, total_turns FROM user_personality_profiles WHERE user_id = $1",
        [user.id]
      );

      const traits = ["O", "C", "E", "A", "N"] as const;

      if (existing.rows.length === 0) {
        const initOcean = {} as Record<string, number>;
        const initConf = {} as Record<string, number>;
        for (const t of traits) {
          initOcean[t] = Number(newOcean[t] ?? 0);
          initConf[t] = Number(newConfidence?.[t] ?? 0.5);
        }
        await client.query(
          `INSERT INTO user_personality_profiles (user_id, ocean_scores, confidence, total_turns, stable)
           VALUES ($1, $2, $3, 1, false)`,
          [user.id, JSON.stringify(initOcean), JSON.stringify(initConf)]
        );
        return { ocean_scores: initOcean, confidence: initConf, total_turns: 1, stable: false };
      }

      const prev = existing.rows[0];
      const prevOcean = prev.ocean_scores;
      const prevConf = prev.confidence;
      const totalTurns = (prev.total_turns ?? 0) + 1;

      const smoothedOcean = {} as Record<string, number>;
      const smoothedConf = {} as Record<string, number>;
      for (const t of traits) {
        const currVal = Number(newOcean[t] ?? 0);
        const currConf = Number(newConfidence?.[t] ?? 0.5);
        const prevVal = Number(prevOcean[t] ?? 0);
        const prevC = Number(prevConf[t] ?? 0.5);

        if (currConf < 0.3) {
          smoothedOcean[t] = prevVal;
          smoothedConf[t] = CROSS_SESSION_ALPHA * currConf + (1 - CROSS_SESSION_ALPHA) * prevC;
        } else {
          smoothedOcean[t] = CROSS_SESSION_ALPHA * currVal + (1 - CROSS_SESSION_ALPHA) * prevVal;
          smoothedConf[t] = CROSS_SESSION_ALPHA * currConf + (1 - CROSS_SESSION_ALPHA) * prevC;
        }
      }

      const variance = traits.reduce((sum, t) => {
        const diff = smoothedOcean[t] - Number(prevOcean[t] ?? 0);
        return sum + diff * diff;
      }, 0) / traits.length;

      const stable = totalTurns >= STABILITY_MIN_TURNS && variance <= STABILITY_VARIANCE;

      await client.query(
        `UPDATE user_personality_profiles
         SET ocean_scores = $2, confidence = $3, total_turns = $4, stable = $5, last_updated = now()
         WHERE user_id = $1`,
        [user.id, JSON.stringify(smoothedOcean), JSON.stringify(smoothedConf), totalTurns, stable]
      );

      return { ocean_scores: smoothedOcean, confidence: smoothedConf, total_turns: totalTurns, stable };
    });

    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    console.error("[personality/profile POST]", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
