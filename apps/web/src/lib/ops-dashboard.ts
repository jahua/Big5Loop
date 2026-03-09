import { readFile } from "fs/promises";
import { hasDatabase, withDb } from "@/lib/db";

const FEEDBACK_LOG_PATH = process.env.FEEDBACK_LOG_PATH ?? "";
const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH ?? "";
const OPS_SOURCE_STALE_DAYS = Number.parseInt(process.env.OPS_SOURCE_STALE_DAYS ?? "30", 10);

type FeedbackEvent = {
  session_id?: string;
  turn_index?: number;
  thumbs_up_down?: "up" | "down";
  helpfulness_score?: number;
  timestamp?: string;
};

type AuditEvent = {
  request_id?: string;
  session_id?: string;
  turn_index?: number;
  coaching_mode?: string;
  pipeline_status?: Record<string, string>;
  routing?: {
    route_key?: string;
    isolation_scope?: string;
    resolved_mode?: string;
    history_turns_used?: number;
    history_filtered?: boolean;
    workflow?: string;
  };
  citation_count?: number;
  verifier_status?: string;
  turn_latency_ms?: number;
  timestamp?: string;
};

export type OpsDashboardData = {
  available: boolean;
  generated_at: string;
  observability: {
    database: boolean;
    audit_db: boolean;
    audit_log_file: boolean;
    feedback_log_file: boolean;
  };
  overview: {
    total_sessions: number;
    recent_sessions_24h: number;
    policy_turns: number;
    citation_coverage_pct: number | null;
    degraded_retrieval_turns: number;
    p95_turn_latency_ms: number | null;
    audit_turns: number;
  };
  retrieval: {
    ok: number;
    degraded: number;
    failed: number;
    skipped: number;
  };
  feedback: {
    total: number;
    up: number;
    down: number;
    average_score: number | null;
    recent: Array<{
      session_id: string;
      turn_index: number | null;
      thumbs_up_down: "up" | "down" | null;
      helpfulness_score: number | null;
      timestamp: string;
    }>;
  };
  recent_sessions: Array<{
    session_id: string;
    turn_count: number;
    last_turn_at: string;
    coaching_mode: string | null;
    route_key: string | null;
    retrieval_status: string | null;
    verifier_status: string | null;
    citation_count: number | null;
    request_id: string | null;
  }>;
  source_freshness: Array<{
    source_id: string;
    title: string | null;
    chunk_count: number;
    last_ingested_at: string;
    days_since_refresh: number;
    stale: boolean;
  }>;
};

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonLines<T>(content: string): T[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter((item): item is T => item !== null);
}

async function loadFeedbackSummary(): Promise<OpsDashboardData["feedback"]> {
  if (!FEEDBACK_LOG_PATH) {
    return { total: 0, up: 0, down: 0, average_score: null, recent: [] };
  }

  try {
    const content = await readFile(FEEDBACK_LOG_PATH, "utf8");
    const events = parseJsonLines<FeedbackEvent>(content)
      .filter((event) => typeof event.timestamp === "string")
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

    const total = events.length;
    const up = events.filter((event) => event.thumbs_up_down === "up").length;
    const down = events.filter((event) => event.thumbs_up_down === "down").length;
    const scored = events.filter((event) => typeof event.helpfulness_score === "number");
    const average_score =
      scored.length > 0
        ? Math.round(
            (scored.reduce((sum, event) => sum + Number(event.helpfulness_score ?? 0), 0) / scored.length) * 100
          ) / 100
        : null;

    return {
      total,
      up,
      down,
      average_score,
      recent: events.slice(0, 8).map((event) => ({
        session_id: String(event.session_id ?? ""),
        turn_index: typeof event.turn_index === "number" ? event.turn_index : null,
        thumbs_up_down: event.thumbs_up_down ?? null,
        helpfulness_score:
          typeof event.helpfulness_score === "number" ? event.helpfulness_score : null,
        timestamp: String(event.timestamp),
      })),
    };
  } catch {
    return { total: 0, up: 0, down: 0, average_score: null, recent: [] };
  }
}

async function loadAuditEvents(): Promise<AuditEvent[]> {
  if (!AUDIT_LOG_PATH) return [];

  try {
    const content = await readFile(AUDIT_LOG_PATH, "utf8");
    return parseJsonLines<AuditEvent>(content)
      .filter((event) => typeof event.session_id === "string")
      .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")));
  } catch {
    return [];
  }
}

export async function buildOpsDashboardData(): Promise<OpsDashboardData> {
  const feedback = await loadFeedbackSummary();
  const auditEvents = await loadAuditEvents();
  const base: OpsDashboardData = {
    available: hasDatabase(),
    generated_at: new Date().toISOString(),
    observability: {
      database: hasDatabase(),
      audit_db: process.env.AUDIT_DB_WRITE === "true" || process.env.AUDIT_DB_WRITE === "1",
      audit_log_file: Boolean(AUDIT_LOG_PATH),
      feedback_log_file: Boolean(FEEDBACK_LOG_PATH),
    },
    overview: {
      total_sessions: 0,
      recent_sessions_24h: 0,
      policy_turns: 0,
      citation_coverage_pct: null,
      degraded_retrieval_turns: 0,
      p95_turn_latency_ms: null,
      audit_turns: 0,
    },
    retrieval: {
      ok: 0,
      degraded: 0,
      failed: 0,
      skipped: 0,
    },
    feedback,
    recent_sessions: [],
    source_freshness: [],
  };

  if (!hasDatabase()) {
    if (auditEvents.length === 0) {
      return base;
    }
    return {
      ...base,
      overview: {
        total_sessions: 0,
        recent_sessions_24h: 0,
        policy_turns: auditEvents.filter((event) =>
          event.coaching_mode === "policy_navigation" || event.coaching_mode === "mixed"
        ).length,
        citation_coverage_pct: (() => {
          const policyEvents = auditEvents.filter((event) =>
            event.coaching_mode === "policy_navigation" || event.coaching_mode === "mixed"
          );
          if (policyEvents.length === 0) return null;
          const cited = policyEvents.filter((event) => Number(event.citation_count ?? 0) > 0).length;
          return Math.round((cited / policyEvents.length) * 1000) / 10;
        })(),
        degraded_retrieval_turns: auditEvents.filter((event) => {
          const status = event.pipeline_status?.retrieval;
          return status === "degraded" || status === "failed";
        }).length,
        p95_turn_latency_ms: (() => {
          const latencies = auditEvents
            .map((event) => toNullableNumber(event.turn_latency_ms))
            .filter((value): value is number => value != null)
            .sort((a, b) => a - b);
          if (latencies.length === 0) return null;
          const idx = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
          return latencies[idx];
        })(),
        audit_turns: auditEvents.length,
      },
      retrieval: {
        ok: auditEvents.filter((event) => event.pipeline_status?.retrieval === "ok").length,
        degraded: auditEvents.filter((event) => event.pipeline_status?.retrieval === "degraded").length,
        failed: auditEvents.filter((event) => event.pipeline_status?.retrieval === "failed").length,
        skipped: auditEvents.filter((event) => {
          const status = event.pipeline_status?.retrieval;
          return !status || status === "skipped";
        }).length,
      },
      recent_sessions: auditEvents.slice(0, 8).map((event) => ({
        session_id: String(event.session_id ?? ""),
        turn_count: typeof event.turn_index === "number" ? event.turn_index : 0,
        last_turn_at: String(event.timestamp ?? base.generated_at),
        coaching_mode: event.coaching_mode ?? null,
        route_key: event.routing?.route_key ?? null,
        retrieval_status: event.pipeline_status?.retrieval ?? null,
        verifier_status: event.verifier_status ?? null,
        citation_count: typeof event.citation_count === "number" ? event.citation_count : null,
        request_id: event.request_id ?? null,
      })),
      source_freshness: [],
    };
  }

  return withDb(async (client) => {
    const routingColumnResult = await client.query<{ has_routing: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'audit_log'
           AND column_name = 'routing'
       ) AS has_routing`
    );
    const hasRouting = Boolean(routingColumnResult.rows[0]?.has_routing);

    const overviewResult = await client.query<{
      total_sessions: string;
      recent_sessions_24h: string;
      policy_turns: string;
      cited_policy_turns: string;
      degraded_retrieval_turns: string;
      p95_turn_latency_ms: string | null;
      audit_turns: string;
      retrieval_ok_turns: string;
      retrieval_degraded_turns: string;
      retrieval_failed_turns: string;
      retrieval_skipped_turns: string;
    }>(`
      SELECT
        (SELECT COUNT(*)::text FROM chat_sessions) AS total_sessions,
        (SELECT COUNT(DISTINCT session_id)::text FROM conversation_turns WHERE created_at >= now() - interval '24 hours') AS recent_sessions_24h,
        (SELECT COUNT(*)::text FROM audit_log WHERE coaching_mode IN ('policy_navigation', 'mixed')) AS policy_turns,
        (SELECT COUNT(*)::text FROM audit_log WHERE coaching_mode IN ('policy_navigation', 'mixed') AND COALESCE(citation_count, 0) > 0) AS cited_policy_turns,
        (SELECT COUNT(*)::text FROM audit_log WHERE pipeline_status->>'retrieval' IN ('degraded', 'failed')) AS degraded_retrieval_turns,
        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY turn_latency_ms) FROM audit_log WHERE turn_latency_ms IS NOT NULL) ::text AS p95_turn_latency_ms,
        (SELECT COUNT(*)::text FROM audit_log) AS audit_turns,
        (SELECT COUNT(*)::text FROM audit_log WHERE pipeline_status->>'retrieval' = 'ok') AS retrieval_ok_turns,
        (SELECT COUNT(*)::text FROM audit_log WHERE pipeline_status->>'retrieval' = 'degraded') AS retrieval_degraded_turns,
        (SELECT COUNT(*)::text FROM audit_log WHERE pipeline_status->>'retrieval' = 'failed') AS retrieval_failed_turns,
        (SELECT COUNT(*)::text FROM audit_log WHERE COALESCE(pipeline_status->>'retrieval', 'skipped') = 'skipped') AS retrieval_skipped_turns
    `);

    const overviewRow = overviewResult.rows[0];
    const policyTurns = toNumber(overviewRow?.policy_turns);
    const citedPolicyTurns = toNumber(overviewRow?.cited_policy_turns);

    const recentSessionsSql = `
      WITH latest_turns AS (
        SELECT session_id, COUNT(*)::int AS turn_count, MAX(created_at) AS last_turn_at
        FROM conversation_turns
        GROUP BY session_id
      ),
      latest_audit AS (
        SELECT DISTINCT ON (session_id)
          session_id,
          request_id,
          coaching_mode,
          citation_count,
          verifier_status,
          pipeline_status->>'retrieval' AS retrieval_status,
          ${hasRouting ? "routing->>'route_key'" : "NULL"} AS route_key,
          created_at
        FROM audit_log
        ORDER BY session_id, created_at DESC
      )
      SELECT
        lt.session_id::text AS session_id,
        lt.turn_count,
        lt.last_turn_at,
        la.coaching_mode,
        la.route_key,
        la.retrieval_status,
        la.verifier_status,
        la.citation_count,
        la.request_id
      FROM latest_turns lt
      LEFT JOIN latest_audit la USING (session_id)
      ORDER BY lt.last_turn_at DESC
      LIMIT 8
    `;
    const recentSessionsResult = await client.query<{
      session_id: string;
      turn_count: number;
      last_turn_at: string;
      coaching_mode: string | null;
      route_key: string | null;
      retrieval_status: string | null;
      verifier_status: string | null;
      citation_count: number | null;
      request_id: string | null;
    }>(recentSessionsSql);

    const sourceFreshnessResult = await client.query<{
      source_id: string;
      title: string | null;
      chunk_count: string;
      last_ingested_at: string;
    }>(`
      SELECT
        source_id,
        MIN(title) AS title,
        COUNT(*)::text AS chunk_count,
        MAX(created_at) AS last_ingested_at
      FROM policy_chunks
      GROUP BY source_id
      ORDER BY MAX(created_at) DESC
      LIMIT 12
    `);

    const nowMs = Date.now();
    const useAuditFileFallback =
      (!base.observability.audit_db || toNumber(overviewRow?.audit_turns) === 0) &&
      auditEvents.length > 0;
    const policyEvents = auditEvents.filter((event) =>
      event.coaching_mode === "policy_navigation" || event.coaching_mode === "mixed"
    );
    const fallbackCitationCoverage =
      policyEvents.length > 0
        ? Math.round(
            (policyEvents.filter((event) => Number(event.citation_count ?? 0) > 0).length / policyEvents.length) * 1000
          ) / 10
        : null;
    const fallbackLatencies = auditEvents
      .map((event) => toNullableNumber(event.turn_latency_ms))
      .filter((value): value is number => value != null)
      .sort((a, b) => a - b);
    const fallbackP95 =
      fallbackLatencies.length > 0
        ? fallbackLatencies[Math.max(0, Math.ceil(fallbackLatencies.length * 0.95) - 1)]
        : null;
    return {
      ...base,
      available: true,
      overview: {
        total_sessions: toNumber(overviewRow?.total_sessions),
        recent_sessions_24h: toNumber(overviewRow?.recent_sessions_24h),
        policy_turns: useAuditFileFallback ? policyEvents.length : policyTurns,
        citation_coverage_pct: useAuditFileFallback
          ? fallbackCitationCoverage
          : policyTurns > 0
            ? Math.round((citedPolicyTurns / policyTurns) * 1000) / 10
            : null,
        degraded_retrieval_turns: useAuditFileFallback
          ? auditEvents.filter((event) => {
              const status = event.pipeline_status?.retrieval;
              return status === "degraded" || status === "failed";
            }).length
          : toNumber(overviewRow?.degraded_retrieval_turns),
        p95_turn_latency_ms: useAuditFileFallback
          ? fallbackP95
          : toNullableNumber(overviewRow?.p95_turn_latency_ms),
        audit_turns: useAuditFileFallback ? auditEvents.length : toNumber(overviewRow?.audit_turns),
      },
      retrieval: {
        ok: useAuditFileFallback
          ? auditEvents.filter((event) => event.pipeline_status?.retrieval === "ok").length
          : toNumber(overviewRow?.retrieval_ok_turns),
        degraded: useAuditFileFallback
          ? auditEvents.filter((event) => event.pipeline_status?.retrieval === "degraded").length
          : toNumber(overviewRow?.retrieval_degraded_turns),
        failed: useAuditFileFallback
          ? auditEvents.filter((event) => event.pipeline_status?.retrieval === "failed").length
          : toNumber(overviewRow?.retrieval_failed_turns),
        skipped: useAuditFileFallback
          ? auditEvents.filter((event) => {
              const status = event.pipeline_status?.retrieval;
              return !status || status === "skipped";
            }).length
          : toNumber(overviewRow?.retrieval_skipped_turns),
      },
      recent_sessions: useAuditFileFallback
        ? auditEvents.slice(0, 8).map((event) => ({
            session_id: String(event.session_id ?? ""),
            turn_count: typeof event.turn_index === "number" ? event.turn_index : 0,
            last_turn_at: String(event.timestamp ?? base.generated_at),
            coaching_mode: event.coaching_mode ?? null,
            route_key: event.routing?.route_key ?? null,
            retrieval_status: event.pipeline_status?.retrieval ?? null,
            verifier_status: event.verifier_status ?? null,
            citation_count: typeof event.citation_count === "number" ? event.citation_count : null,
            request_id: event.request_id ?? null,
          }))
        : recentSessionsResult.rows.map((row) => ({
            session_id: row.session_id,
            turn_count: row.turn_count,
            last_turn_at: row.last_turn_at,
            coaching_mode: row.coaching_mode,
            route_key: row.route_key,
            retrieval_status: row.retrieval_status,
            verifier_status: row.verifier_status,
            citation_count: row.citation_count,
            request_id: row.request_id,
          })),
      source_freshness: sourceFreshnessResult.rows.map((row) => {
        const ageMs = Math.max(0, nowMs - new Date(row.last_ingested_at).getTime());
        const daysSinceRefresh = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        return {
          source_id: row.source_id,
          title: row.title,
          chunk_count: toNumber(row.chunk_count),
          last_ingested_at: row.last_ingested_at,
          days_since_refresh: daysSinceRefresh,
          stale: daysSinceRefresh >= OPS_SOURCE_STALE_DAYS,
        };
      }),
    };
  });
}
