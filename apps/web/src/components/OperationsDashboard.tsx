"use client";

import { useEffect, useMemo, useState } from "react";
import type { OpsDashboardData } from "@/lib/ops-dashboard";

type OpsResponse =
  | { success: true; data: OpsDashboardData }
  | { success: false; error?: string };

function formatLatency(ms: number | null): string {
  if (ms == null) return "n/a";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function OperationsDashboard() {
  const [data, setData] = useState<OpsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/ops/dashboard", { cache: "no-store" });
        const json = (await response.json()) as OpsResponse;
        if (!response.ok || !json.success) {
          throw new Error(("error" in json && json.error) || `HTTP ${response.status}`);
        }
        if (!cancelled) {
          setData(json.data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const badges = useMemo(() => {
    if (!data) return [];
    return [
      data.observability.database ? "DB connected" : "DB unavailable",
      data.observability.audit_db ? "Audit DB write on" : "Audit DB write off",
      data.observability.feedback_log_file ? "Feedback log on" : "Feedback log off",
    ];
  }, [data]);

  if (loading && !data) {
    return <div className="careloop-ops careloop-ops--status">Loading operations data…</div>;
  }

  if (error && !data) {
    return <div className="careloop-ops careloop-ops--status">Operations dashboard unavailable: {error}</div>;
  }

  if (!data) return null;

  return (
    <div className="careloop-ops">
      <div className="careloop-ops__header">
        <div>
          <div className="careloop-panel__title">Operations dashboard</div>
          <p className="careloop-ops__sub">Pilot-facing monitoring for routing, evidence quality, audit, and feedback.</p>
        </div>
        <span className="careloop-ops__timestamp">{formatDate(data.generated_at)}</span>
      </div>

      <div className="careloop-ops__badges">
        {badges.map((badge) => (
          <span key={badge} className="careloop-badge careloop-badge--learning">
            {badge}
          </span>
        ))}
      </div>

      {!data.available && (
        <div className="careloop-ops__notice">
          Database-backed metrics are unavailable. Set `DATABASE_URL` to enable session review, citation metrics, and source freshness monitoring.
        </div>
      )}

      <div className="careloop-ops__stats">
        <div className="careloop-ops__stat">
          <span className="careloop-ops__stat-value">{data.overview.total_sessions}</span>
          <span className="careloop-ops__stat-label">Sessions</span>
        </div>
        <div className="careloop-ops__stat">
          <span className="careloop-ops__stat-value">{data.overview.recent_sessions_24h}</span>
          <span className="careloop-ops__stat-label">24h active</span>
        </div>
        <div className="careloop-ops__stat">
          <span className="careloop-ops__stat-value">
            {data.overview.citation_coverage_pct == null ? "n/a" : `${data.overview.citation_coverage_pct}%`}
          </span>
          <span className="careloop-ops__stat-label">Citation coverage</span>
        </div>
        <div className="careloop-ops__stat">
          <span className="careloop-ops__stat-value">{data.overview.degraded_retrieval_turns}</span>
          <span className="careloop-ops__stat-label">Degraded retrieval</span>
        </div>
        <div className="careloop-ops__stat">
          <span className="careloop-ops__stat-value">{formatLatency(data.overview.p95_turn_latency_ms)}</span>
          <span className="careloop-ops__stat-label">p95 latency</span>
        </div>
      </div>

      <section className="careloop-ops__section">
        <div className="careloop-ops__section-title">Session review</div>
        <div className="careloop-ops__list">
          {data.recent_sessions.length === 0 && <div className="careloop-ops__empty">No session records yet.</div>}
          {data.recent_sessions.map((session) => (
            <div key={session.session_id} className="careloop-ops__card">
              <div className="careloop-ops__card-top">
                <span className="careloop-ops__mono">{session.session_id.slice(0, 8)}…</span>
                <span className="careloop-badge careloop-badge--mode">
                  {(session.coaching_mode ?? "unknown").replace(/_/g, " ")}
                </span>
              </div>
              <div className="careloop-ops__rows">
                <div className="careloop-ops__row">
                  <span>Turns</span>
                  <span>{session.turn_count}</span>
                </div>
                <div className="careloop-ops__row">
                  <span>Last activity</span>
                  <span>{formatDate(session.last_turn_at)}</span>
                </div>
                <div className="careloop-ops__row">
                  <span>Route</span>
                  <span className="careloop-ops__mono">
                    {session.route_key ? session.route_key.split(":").slice(-1)[0] : "n/a"}
                  </span>
                </div>
                <div className="careloop-ops__row">
                  <span>Retrieval</span>
                  <span>{session.retrieval_status ?? "n/a"}</span>
                </div>
                <div className="careloop-ops__row">
                  <span>Verifier</span>
                  <span>{session.verifier_status ?? "n/a"}</span>
                </div>
                <div className="careloop-ops__row">
                  <span>Citations</span>
                  <span>{session.citation_count ?? 0}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="careloop-ops__section">
        <div className="careloop-ops__section-title">Citation and retrieval quality</div>
        <div className="careloop-ops__rows">
          <div className="careloop-ops__row">
            <span>Policy turns</span>
            <span>{data.overview.policy_turns}</span>
          </div>
          <div className="careloop-ops__row">
            <span>Retrieval ok</span>
            <span>{data.retrieval.ok}</span>
          </div>
          <div className="careloop-ops__row">
            <span>Retrieval degraded</span>
            <span>{data.retrieval.degraded}</span>
          </div>
          <div className="careloop-ops__row">
            <span>Retrieval failed</span>
            <span>{data.retrieval.failed}</span>
          </div>
          <div className="careloop-ops__row">
            <span>Retrieval skipped</span>
            <span>{data.retrieval.skipped}</span>
          </div>
          <div className="careloop-ops__row">
            <span>Audit turns</span>
            <span>{data.overview.audit_turns}</span>
          </div>
        </div>
      </section>

      <section className="careloop-ops__section">
        <div className="careloop-ops__section-title">User feedback analysis</div>
        <div className="careloop-ops__rows">
          <div className="careloop-ops__row">
            <span>Total feedback</span>
            <span>{data.feedback.total}</span>
          </div>
          <div className="careloop-ops__row">
            <span>Helpful</span>
            <span>{data.feedback.up}</span>
          </div>
          <div className="careloop-ops__row">
            <span>Not helpful</span>
            <span>{data.feedback.down}</span>
          </div>
          <div className="careloop-ops__row">
            <span>Average score</span>
            <span>{data.feedback.average_score == null ? "n/a" : data.feedback.average_score}</span>
          </div>
        </div>
        <div className="careloop-ops__list">
          {data.feedback.recent.length === 0 && <div className="careloop-ops__empty">No feedback events yet.</div>}
          {data.feedback.recent.map((item, index) => (
            <div key={`${item.session_id}-${item.timestamp}-${index}`} className="careloop-ops__mini-card">
              <div className="careloop-ops__card-top">
                <span className="careloop-ops__mono">{item.session_id.slice(0, 8)}…</span>
                <span>{formatDate(item.timestamp)}</span>
              </div>
              <div className="careloop-ops__row">
                <span>Signal</span>
                <span>{item.thumbs_up_down ?? "score only"}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="careloop-ops__section">
        <div className="careloop-ops__section-title">Source freshness monitoring</div>
        <div className="careloop-ops__list">
          {data.source_freshness.length === 0 && <div className="careloop-ops__empty">No source freshness data yet.</div>}
          {data.source_freshness.map((source) => (
            <div key={source.source_id} className="careloop-ops__mini-card">
              <div className="careloop-ops__card-top">
                <span className="careloop-ops__source-title">{source.title ?? source.source_id}</span>
                <span
                  className={`careloop-badge ${source.stale ? "careloop-badge--error" : "careloop-badge--stable"}`}
                >
                  {source.stale ? "stale" : "fresh"}
                </span>
              </div>
              <div className="careloop-ops__row">
                <span>Chunks</span>
                <span>{source.chunk_count}</span>
              </div>
              <div className="careloop-ops__row">
                <span>Last ingest</span>
                <span>{formatDate(source.last_ingested_at)}</span>
              </div>
              <div className="careloop-ops__row">
                <span>Age</span>
                <span>{source.days_since_refresh}d</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
