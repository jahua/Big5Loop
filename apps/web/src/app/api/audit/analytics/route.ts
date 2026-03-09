import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { withDb, hasDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasDatabase()) {
    return NextResponse.json({ analytics: null });
  }

  try {
    const analytics = await withDb(async (client) => {
      const uid = user.id;

      const [
        summaryRes,
        latencySummaryRes,
        dailyActivityRes,
        modeDistRes,
        latencyDistRes,
        msgLengthRes,
        topCitationsRes,
        pipelineRes,
        sessionStatsRes,
        hourlyRes,
        personalityEvoRes,
        weekdayRes,
        modeTrendRes,
      ] = await Promise.all([
        // 1) Summary stats (from conversation_turns)
        client.query(
          `SELECT
             COUNT(DISTINCT s.session_id)::int AS session_count,
             COUNT(t.turn_index)::int AS turn_count,
             ROUND(AVG(LENGTH(t.user_msg)))::int AS avg_user_msg_len,
             ROUND(AVG(LENGTH(COALESCE(t.assistant_msg,''))))::int AS avg_assistant_msg_len,
             SUM(LENGTH(t.user_msg))::int AS total_user_chars,
             SUM(LENGTH(COALESCE(t.assistant_msg,'')))::int AS total_assistant_chars,
             MIN(t.created_at) AS first_activity,
             MAX(t.created_at) AS last_activity
           FROM chat_sessions s
           LEFT JOIN conversation_turns t ON t.session_id = s.session_id
           WHERE s.user_id = $1`,
          [uid]
        ),

        // 1b) Latency stats from performance_metrics (end_to_end stage)
        client.query(
          `SELECT
             ROUND(AVG(pm.duration_ms))::int AS avg_latency_ms,
             MIN(pm.duration_ms)::int AS min_latency_ms,
             MAX(pm.duration_ms)::int AS max_latency_ms,
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pm.duration_ms)::int AS median_latency_ms,
             PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY pm.duration_ms)::int AS p95_latency_ms
           FROM performance_metrics pm
           JOIN chat_sessions s ON s.session_id = pm.session_id
           WHERE s.user_id = $1 AND pm.stage = 'end_to_end'`,
          [uid]
        ),

        // 2) Daily activity (last 30 days)
        client.query(
          `SELECT d.day::date AS day, COALESCE(c.cnt, 0)::int AS count
           FROM generate_series(
             CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, '1 day'
           ) AS d(day)
           LEFT JOIN (
             SELECT DATE(t.created_at) AS day, COUNT(*)::int AS cnt
             FROM conversation_turns t
             JOIN chat_sessions s ON s.session_id = t.session_id
             WHERE s.user_id = $1 AND t.created_at >= CURRENT_DATE - INTERVAL '29 days'
             GROUP BY DATE(t.created_at)
           ) c ON c.day = d.day::date
           ORDER BY d.day`,
          [uid]
        ),

        // 3) Coaching mode distribution
        client.query(
          `SELECT COALESCE(t.mode, 'unknown') AS mode, COUNT(*)::int AS count
           FROM conversation_turns t
           JOIN chat_sessions s ON s.session_id = t.session_id
           WHERE s.user_id = $1
           GROUP BY t.mode
           ORDER BY count DESC`,
          [uid]
        ),

        // 4) Latency distribution from performance_metrics (end_to_end)
        client.query(
          `SELECT
             CASE
               WHEN pm.duration_ms < 500 THEN '< 0.5s'
               WHEN pm.duration_ms < 1000 THEN '0.5–1s'
               WHEN pm.duration_ms < 2000 THEN '1–2s'
               WHEN pm.duration_ms < 5000 THEN '2–5s'
               WHEN pm.duration_ms < 10000 THEN '5–10s'
               ELSE '> 10s'
             END AS bucket,
             COUNT(*)::int AS count
           FROM performance_metrics pm
           JOIN chat_sessions s ON s.session_id = pm.session_id
           WHERE s.user_id = $1 AND pm.stage = 'end_to_end'
           GROUP BY bucket
           ORDER BY MIN(pm.duration_ms)`,
          [uid]
        ),

        // 5) Message length distribution
        client.query(
          `WITH lengths AS (
             SELECT LENGTH(t.user_msg) AS len, LENGTH(COALESCE(t.assistant_msg,'')) AS alen
             FROM conversation_turns t
             JOIN chat_sessions s ON s.session_id = t.session_id
             WHERE s.user_id = $1
           )
           SELECT
             CASE
               WHEN len < 20 THEN '0–20'
               WHEN len < 50 THEN '20–50'
               WHEN len < 100 THEN '50–100'
               WHEN len < 200 THEN '100–200'
               WHEN len < 500 THEN '200–500'
               ELSE '500+'
             END AS user_bucket,
             COUNT(*)::int AS user_count,
             ROUND(AVG(alen))::int AS avg_response_len
           FROM lengths
           GROUP BY user_bucket
           ORDER BY MIN(len)`,
          [uid]
        ),

        // 6) Top policy citations
        client.query(
          `SELECT pe.title, pe.source_id, COUNT(*)::int AS cite_count
           FROM policy_evidence pe
           JOIN chat_sessions s ON s.session_id = pe.session_id
           WHERE s.user_id = $1
           GROUP BY pe.title, pe.source_id
           ORDER BY cite_count DESC
           LIMIT 10`,
          [uid]
        ),

        // 7) Pipeline performance by stage
        client.query(
          `SELECT pm.stage,
                  COUNT(*)::int AS invocations,
                  ROUND(AVG(pm.duration_ms))::int AS avg_ms,
                  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pm.duration_ms)::int AS median_ms,
                  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY pm.duration_ms)::int AS p95_ms,
                  MAX(pm.duration_ms)::int AS max_ms,
                  SUM(CASE WHEN pm.status = 'error' THEN 1 ELSE 0 END)::int AS errors
           FROM performance_metrics pm
           JOIN chat_sessions s ON s.session_id = pm.session_id
           WHERE s.user_id = $1
           GROUP BY pm.stage
           ORDER BY avg_ms DESC`,
          [uid]
        ),

        // 8) Per-session stats (with latency from perf metrics)
        client.query(
          `SELECT s.session_id,
                  s.created_at,
                  COUNT(DISTINCT t.turn_index)::int AS turns,
                  ROUND(AVG(pm.duration_ms) FILTER (WHERE pm.stage = 'end_to_end'))::int AS avg_latency,
                  SUM(LENGTH(t.user_msg))::int AS user_chars,
                  SUM(LENGTH(COALESCE(t.assistant_msg,'')))::int AS assistant_chars,
                  MAX(t.created_at) AS last_turn_at,
                  EXTRACT(EPOCH FROM (MAX(t.created_at) - MIN(t.created_at)))::int AS duration_secs
           FROM chat_sessions s
           LEFT JOIN conversation_turns t ON t.session_id = s.session_id
           LEFT JOIN performance_metrics pm ON pm.session_id = s.session_id AND pm.turn_index = t.turn_index
           WHERE s.user_id = $1
           GROUP BY s.session_id, s.created_at
           HAVING COUNT(t.turn_index) > 0
           ORDER BY s.created_at DESC
           LIMIT 50`,
          [uid]
        ),

        // 9) Hourly activity heatmap
        client.query(
          `SELECT EXTRACT(HOUR FROM t.created_at)::int AS hour, COUNT(*)::int AS count
           FROM conversation_turns t
           JOIN chat_sessions s ON s.session_id = t.session_id
           WHERE s.user_id = $1
           GROUP BY hour
           ORDER BY hour`,
          [uid]
        ),

        // 10) Personality evolution over time
        client.query(
          `SELECT ps.created_at, ps.ocean_json, ps.confidence_json, ps.stable
           FROM personality_states ps
           JOIN chat_sessions s ON s.session_id = ps.session_id
           WHERE s.user_id = $1
             AND ps.ocean_json != '{"A": 0, "C": 0, "E": 0, "N": 0, "O": 0}'::jsonb
           ORDER BY ps.created_at ASC
           LIMIT 200`,
          [uid]
        ),

        // 11) Weekday distribution
        client.query(
          `SELECT EXTRACT(DOW FROM t.created_at)::int AS dow, COUNT(*)::int AS count
           FROM conversation_turns t
           JOIN chat_sessions s ON s.session_id = t.session_id
           WHERE s.user_id = $1
           GROUP BY dow
           ORDER BY dow`,
          [uid]
        ),

        // 12) Mode trend over days
        client.query(
          `SELECT DATE(t.created_at) AS day, t.mode, COUNT(*)::int AS count
           FROM conversation_turns t
           JOIN chat_sessions s ON s.session_id = t.session_id
           WHERE s.user_id = $1 AND t.mode IS NOT NULL
             AND t.created_at >= CURRENT_DATE - INTERVAL '29 days'
           GROUP BY DATE(t.created_at), t.mode
           ORDER BY day`,
          [uid]
        ),
      ]);

      const summary = summaryRes.rows[0] ?? {};
      const latencySummary = latencySummaryRes.rows[0] ?? {};

      return {
        summary: { ...summary, ...latencySummary },
        daily_activity: dailyActivityRes.rows,
        mode_distribution: modeDistRes.rows,
        latency_distribution: latencyDistRes.rows,
        msg_length_distribution: msgLengthRes.rows,
        top_citations: topCitationsRes.rows,
        pipeline_performance: pipelineRes.rows,
        session_stats: sessionStatsRes.rows,
        hourly_activity: hourlyRes.rows,
        personality_evolution: personalityEvoRes.rows,
        weekday_activity: weekdayRes.rows,
        mode_trend: modeTrendRes.rows,
      };
    });

    return NextResponse.json({ analytics });
  } catch (err) {
    console.error("[audit/analytics]", err);
    return NextResponse.json({ analytics: null, error: String(err) });
  }
}
