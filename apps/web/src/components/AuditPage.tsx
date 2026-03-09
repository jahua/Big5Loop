"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/components/AuthProvider";

/* ── Types ── */
type Analytics = {
  summary: {
    session_count: number; turn_count: number;
    avg_latency_ms: number | null; min_latency_ms: number | null; max_latency_ms: number | null;
    median_latency_ms: number | null; p95_latency_ms: number | null;
    avg_user_msg_len: number | null; avg_assistant_msg_len: number | null;
    total_user_chars: number; total_assistant_chars: number;
    first_activity: string | null; last_activity: string | null;
  } | null;
  daily_activity: { day: string; count: number }[];
  mode_distribution: { mode: string; count: number }[];
  latency_distribution: { bucket: string; count: number }[];
  msg_length_distribution: { user_bucket: string; user_count: number; avg_response_len: number }[];
  top_citations: { title: string; source_id: string; cite_count: number }[];
  pipeline_performance: { stage: string; invocations: number; avg_ms: number; median_ms: number; p95_ms: number; max_ms: number; errors: number }[];
  session_stats: {
    session_id: string; created_at: string; turns: number; avg_latency: number | null;
    user_chars: number; assistant_chars: number; last_turn_at: string; duration_secs: number | null;
  }[];
  hourly_activity: { hour: number; count: number }[];
  personality_evolution: { created_at: string; ocean_json: Record<string, number>; confidence_json: Record<string, number>; stable: boolean }[];
  weekday_activity: { dow: number; count: number }[];
  mode_trend: { day: string; mode: string; count: number }[];
};

type AuditSession = {
  session_id: string; created_at: string; status: string; turn_count: number; modes: string[];
};

type AuditTurn = {
  turn_index: number; user_msg: string; assistant_msg: string | null;
  mode: string | null; latency_ms: number | null; created_at: string;
};

/* ── Helpers ── */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtMs(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${n}ms`;
}

function fmtDuration(secs: number | null): string {
  if (!secs || secs < 0) return "< 1s";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

const MODE_COLORS: Record<string, string> = {
  emotional_support: "#e53935",
  practical_education: "#1e88e5",
  policy_navigation: "#43a047",
  mixed: "#fb8c00",
  unknown: "#9e9e9e",
};

const OCEAN_COLORS: Record<string, string> = {
  O: "#7c4dff", C: "#00bcd4", E: "#ff9800", A: "#4caf50", N: "#f44336",
};
const OCEAN_NAMES: Record<string, string> = {
  O: "Openness", C: "Conscientiousness", E: "Extraversion", A: "Agreeableness", N: "Neuroticism",
};

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function modeBadgeClass(mode: string | null) {
  switch (mode) {
    case "emotional_support": return "careloop-badge--emotional";
    case "practical_education": return "careloop-badge--education";
    case "policy_navigation": return "careloop-badge--policy";
    case "mixed": return "careloop-badge--mixed";
    default: return "";
  }
}

/* ── SVG Charts ── */

function BarChart({ data, width = 620, height = 170, color }: {
  data: { label: string; value: number }[]; width?: number; height?: number; color?: string;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0))
    return <p className="careloop-chart__empty">No activity in this period</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = Math.max(4, (width - 44) / data.length - 2);
  const chartH = height - 32;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="careloop-chart-svg" preserveAspectRatio="xMidYMid meet">
      {data.map((d, i) => {
        const bh = (d.value / max) * (chartH - 10);
        const x = 34 + i * (barW + 2);
        return (
          <g key={i}>
            <rect x={x} y={chartH - bh} width={barW} height={Math.max(bh, 0.5)}
              fill={color ?? "var(--color-primary)"} rx={2} opacity={d.value > 0 ? 0.85 : 0.15}>
              <title>{`${d.label}: ${d.value}`}</title>
            </rect>
            {data.length <= 10 && (
              <text x={x + barW / 2} y={chartH + 14} textAnchor="middle"
                fill="var(--color-text-muted)" fontSize="9">{d.label}</text>
            )}
          </g>
        );
      })}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={32} y1={chartH - (chartH - 10) * f} x2={width} y2={chartH - (chartH - 10) * f}
          stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="3 3" />
      ))}
      <line x1={32} y1={0} x2={32} y2={chartH} stroke="var(--color-border)" strokeWidth="1" />
      <line x1={32} y1={chartH} x2={width} y2={chartH} stroke="var(--color-border)" strokeWidth="1" />
      <text x={4} y={14} fill="var(--color-text-muted)" fontSize="9">{max}</text>
      <text x={4} y={chartH} fill="var(--color-text-muted)" fontSize="9">0</text>
    </svg>
  );
}

function DonutChart({ data, size = 180 }: {
  data: { label: string; value: number; color: string }[]; size?: number;
}) {
  if (data.length === 0) return <p className="careloop-chart__empty">No data</p>;
  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = size / 2, cy = size / 2, r = size * 0.35, strokeW = size * 0.12;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="careloop-donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {data.map((d, i) => {
          const pct = d.value / total;
          const dash = pct * circ;
          const gap = circ - dash;
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r}
              fill="none" stroke={d.color} strokeWidth={strokeW}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}>
              <title>{`${d.label}: ${d.value} (${(pct * 100).toFixed(0)}%)`}</title>
            </circle>
          );
          offset += dash;
          return el;
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--color-text)" fontSize="20" fontWeight="700">
          {total}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--color-text-muted)" fontSize="10">
          total turns
        </text>
      </svg>
      <div className="careloop-donut-legend">
        {data.map((d) => (
          <div key={d.label} className="careloop-donut-legend__item">
            <span className="careloop-donut-legend__dot" style={{ background: d.color }} />
            <span className="careloop-donut-legend__label">{d.label.replace(/_/g, " ")}</span>
            <span className="careloop-donut-legend__value">
              {d.value} <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                ({(d.value / total * 100).toFixed(0)}%)
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HourlyHeatmap({ data }: { data: { hour: number; count: number }[] }) {
  const map = new Map(data.map((d) => [d.hour, d.count]));
  const max = Math.max(...data.map((d) => d.count), 1);
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="careloop-heatmap">
      {hours.map((h) => {
        const val = map.get(h) ?? 0;
        const intensity = val / max;
        return (
          <div key={h} className="careloop-heatmap__cell" title={`${h}:00 — ${val} messages`}
            style={{ opacity: Math.max(0.08, intensity), background: "var(--color-primary)" }}>
            <span className="careloop-heatmap__hour">{h}</span>
          </div>
        );
      })}
    </div>
  );
}

function LatencyHistogram({ data }: { data: { bucket: string; count: number }[] }) {
  if (data.length === 0) return <p className="careloop-chart__empty">No latency data</p>;
  const max = Math.max(...data.map((d) => d.count), 1);
  const w = 420, h = 140, barW = Math.min(52, (w - 50) / data.length - 6);
  const chartH = h - 30;

  const bucketColors = ["#43a047", "#66bb6a", "#fdd835", "#fb8c00", "#e53935", "#b71c1c"];

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="careloop-chart-svg">
      {data.map((d, i) => {
        const bh = (d.count / max) * (chartH - 8);
        const x = 40 + i * (barW + 8);
        return (
          <g key={i}>
            <rect x={x} y={chartH - bh} width={barW} height={Math.max(bh, 1)}
              fill={bucketColors[i] ?? "#9e9e9e"} rx={3}>
              <title>{`${d.bucket}: ${d.count} turns`}</title>
            </rect>
            <text x={x + barW / 2} y={chartH - bh - 5} textAnchor="middle"
              fill="var(--color-text-secondary)" fontSize="10" fontWeight="600">{d.count}</text>
            <text x={x + barW / 2} y={chartH + 14} textAnchor="middle"
              fill="var(--color-text-muted)" fontSize="9">{d.bucket}</text>
          </g>
        );
      })}
    </svg>
  );
}

function PersonalityTimeline({ data }: { data: Analytics["personality_evolution"] }) {
  const traits = ["O", "C", "E", "A", "N"] as const;
  if (data.length < 2) return <p className="careloop-chart__empty">Need more conversation data for personality evolution</p>;

  const w = 620, h = 200, pad = 44;
  const plotW = w - pad * 2, plotH = h - 44;
  const stepX = plotW / Math.max(data.length - 1, 1);

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="careloop-chart-svg">
      <line x1={pad} y1={22 + plotH / 2} x2={w - pad} y2={22 + plotH / 2}
        stroke="var(--color-border)" strokeWidth="1" strokeDasharray="4 4" />
      <text x={pad - 6} y={26} textAnchor="end" fill="var(--color-text-muted)" fontSize="9">+1</text>
      <text x={pad - 6} y={22 + plotH / 2 + 3} textAnchor="end" fill="var(--color-text-muted)" fontSize="9">0</text>
      <text x={pad - 6} y={22 + plotH - 2} textAnchor="end" fill="var(--color-text-muted)" fontSize="9">-1</text>

      {traits.map((t) => {
        const points = data.map((d, i) => ({
          x: pad + i * stepX,
          y: 22 + ((1 - (d.ocean_json[t] ?? 0)) / 2) * plotH,
        }));
        const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        const last = points[points.length - 1];
        return (
          <g key={t}>
            <path d={line} fill="none" stroke={OCEAN_COLORS[t]} strokeWidth="2" opacity={0.85} />
            <circle cx={last.x} cy={last.y} r={4} fill={OCEAN_COLORS[t]} stroke="#fff" strokeWidth="1.5" />
            <text x={last.x + 10} y={last.y + 4}
              fill={OCEAN_COLORS[t]} fontSize="10" fontWeight="600">{t}</text>
          </g>
        );
      })}
    </svg>
  );
}

function MsgLengthChart({ data }: { data: Analytics["msg_length_distribution"] }) {
  if (data.length === 0) return <p className="careloop-chart__empty">No data</p>;
  const maxUser = Math.max(...data.map((d) => d.user_count), 1);
  const w = 440, h = 160, barW = Math.min(36, (w - 60) / data.length - 8);
  const chartH = h - 30;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="careloop-chart-svg">
      {data.map((d, i) => {
        const bh = (d.user_count / maxUser) * (chartH - 10);
        const x = 44 + i * (barW * 2 + 14);
        return (
          <g key={i}>
            <rect x={x} y={chartH - bh} width={barW} height={Math.max(bh, 1)}
              fill="var(--color-primary)" rx={2} opacity={0.8}>
              <title>{`User msgs ${d.user_bucket}: ${d.user_count}`}</title>
            </rect>
            <text x={x + barW / 2} y={chartH - bh - 4} textAnchor="middle"
              fill="var(--color-text-muted)" fontSize="8">{d.user_count}</text>
            <text x={x + barW} y={chartH + 14} textAnchor="middle"
              fill="var(--color-text-muted)" fontSize="8">{d.user_bucket}</text>
          </g>
        );
      })}
      <g transform={`translate(${w - 100}, 6)`}>
        <rect x={0} y={0} width={8} height={8} fill="var(--color-primary)" opacity={0.8} rx={1} />
        <text x={12} y={8} fill="var(--color-text-muted)" fontSize="9">User messages</text>
      </g>
    </svg>
  );
}

function WeekdayChart({ data }: { data: { dow: number; count: number }[] }) {
  const map = new Map(data.map((d) => [d.dow, d.count]));
  const bars = DOW_NAMES.map((name, i) => ({ label: name, value: map.get(i) ?? 0 }));
  return <BarChart data={bars} width={340} height={140} color="#7c4dff" />;
}

/* ── Architecture Diagram ── */
function ArchitectureDiagram() {
  return (
    <div className="careloop-arch">
      <div className="careloop-arch__row">
        <div className="careloop-arch__node careloop-arch__node--user">
          <div className="careloop-arch__node-icon">User</div>
          <div className="careloop-arch__node-label">Next.js Frontend</div>
        </div>
        <div className="careloop-arch__arrow">&#8594;</div>
        <div className="careloop-arch__node careloop-arch__node--api">
          <div className="careloop-arch__node-icon">API</div>
          <div className="careloop-arch__node-label">Chat Route</div>
        </div>
        <div className="careloop-arch__arrow">&#8594;</div>
        <div className="careloop-arch__node careloop-arch__node--n8n">
          <div className="careloop-arch__node-icon">n8n</div>
          <div className="careloop-arch__node-label">Orchestrator</div>
        </div>
      </div>

      <div className="careloop-arch__pipeline">
        <div className="careloop-arch__stage careloop-arch__stage--routing">
          <span className="careloop-arch__stage-num">1</span>
          <span className="careloop-arch__stage-name">Routing</span>
          <span className="careloop-arch__stage-desc">Classify intent &amp; mode</span>
        </div>
        <div className="careloop-arch__connector" />
        <div className="careloop-arch__stage careloop-arch__stage--detection">
          <span className="careloop-arch__stage-num">2</span>
          <span className="careloop-arch__stage-name">Detection</span>
          <span className="careloop-arch__stage-desc">OCEAN personality analysis</span>
        </div>
        <div className="careloop-arch__connector" />
        <div className="careloop-arch__stage careloop-arch__stage--retrieval">
          <span className="careloop-arch__stage-num">3</span>
          <span className="careloop-arch__stage-name">Retrieval</span>
          <span className="careloop-arch__stage-desc">RAG policy search</span>
        </div>
        <div className="careloop-arch__connector" />
        <div className="careloop-arch__stage careloop-arch__stage--grounding">
          <span className="careloop-arch__stage-num">4</span>
          <span className="careloop-arch__stage-name">Grounding</span>
          <span className="careloop-arch__stage-desc">Context + personality</span>
        </div>
        <div className="careloop-arch__connector" />
        <div className="careloop-arch__stage careloop-arch__stage--generation">
          <span className="careloop-arch__stage-num">5</span>
          <span className="careloop-arch__stage-name">Generation</span>
          <span className="careloop-arch__stage-desc">LLM response synthesis</span>
        </div>
        <div className="careloop-arch__connector" />
        <div className="careloop-arch__stage careloop-arch__stage--verification">
          <span className="careloop-arch__stage-num">6</span>
          <span className="careloop-arch__stage-name">Verification</span>
          <span className="careloop-arch__stage-desc">Fact-check &amp; citations</span>
        </div>
      </div>

      <div className="careloop-arch__row careloop-arch__row--bottom">
        <div className="careloop-arch__node careloop-arch__node--db">
          <div className="careloop-arch__node-icon">DB</div>
          <div className="careloop-arch__node-label">PostgreSQL + pgvector</div>
        </div>
        <div className="careloop-arch__storage-items">
          <span>Sessions</span>
          <span>Turns</span>
          <span>Personality</span>
          <span>Metrics</span>
          <span>Citations</span>
          <span>Embeddings</span>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ── */
type Tab = "overview" | "pipeline" | "sessions";

export default function AuditPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [turns, setTurns] = useState<AuditTurn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTurns, setLoadingTurns] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch("/api/audit/analytics").then((r) => r.json()),
      fetch("/api/audit/sessions").then((r) => r.json()),
    ])
      .then(([aData, sData]) => {
        setAnalytics(aData?.analytics ?? null);
        setSessions(Array.isArray(sData?.sessions) ? sData.sessions : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const loadTurns = (sessionId: string) => {
    setSelectedSession(sessionId);
    setLoadingTurns(true);
    fetch(`/api/audit/turns?session_id=${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((data) => setTurns(Array.isArray(data?.turns) ? data.turns : []))
      .catch(() => setTurns([]))
      .finally(() => setLoadingTurns(false));
  };

  const dailyData = useMemo(() =>
    (analytics?.daily_activity ?? []).map((d) => ({
      label: new Date(d.day).toLocaleDateString("en", { month: "short", day: "numeric" }),
      value: d.count,
    }))
  , [analytics]);

  const modeData = useMemo(() =>
    (analytics?.mode_distribution ?? []).map((d) => ({
      label: d.mode, value: d.count, color: MODE_COLORS[d.mode] ?? "#9e9e9e",
    }))
  , [analytics]);

  const s = analytics?.summary;
  const pp = analytics?.pipeline_performance ?? [];

  if (loading) {
    return (
      <div className="careloop-page">
        <div className="careloop-page__header"><h1>Audit & Analytics</h1></div>
        <div className="careloop-page__content"><p className="careloop-page__loading">Loading analytics…</p></div>
      </div>
    );
  }

  return (
    <div className="careloop-page">
      <div className="careloop-page__header">
        <h1>Audit & Analytics</h1>
        <p className="careloop-page__subtitle">Usage analytics, pipeline performance, and conversation history</p>
        <div className="careloop-page__tabs">
          <button type="button" className={`careloop-page__tab ${tab === "overview" ? "careloop-page__tab--active" : ""}`}
            onClick={() => setTab("overview")}>Overview</button>
          <button type="button" className={`careloop-page__tab ${tab === "pipeline" ? "careloop-page__tab--active" : ""}`}
            onClick={() => setTab("pipeline")}>Pipeline & Architecture</button>
          <button type="button" className={`careloop-page__tab ${tab === "sessions" ? "careloop-page__tab--active" : ""}`}
            onClick={() => setTab("sessions")}>Sessions ({sessions.length})</button>
        </div>
      </div>

      <div className="careloop-page__content">

        {/* ═══════ OVERVIEW TAB ═══════ */}
        {tab === "overview" && (
          <>
            {/* Project Overview */}
            <section className="careloop-card careloop-text-section">
              <h2 className="careloop-card__title">CareLoop System Overview</h2>
              <div className="careloop-text-block">
                <p>
                  <strong>CareLoop</strong> is a personality-aware conversational assistant for Swiss social insurance (IV/AHV/EL) navigation, developed as a thesis project at HSLU. It combines <strong>RAG-based policy retrieval</strong>, <strong>Big Five personality detection</strong>, and <strong>adaptive response generation</strong> to deliver personalized guidance to users navigating complex social insurance processes.
                </p>
                <p>
                  The system architecture consists of a <strong>Next.js frontend</strong>, an <strong>n8n workflow orchestrator</strong> implementing a 6-stage pipeline (routing, detection, retrieval, grounding, generation, verification), and a <strong>PostgreSQL + pgvector</strong> backend for session persistence, personality state tracking, and policy chunk storage.
                </p>
                <p>
                  This analytics dashboard provides full transparency into system usage, performance characteristics, and conversation patterns — supporting both development iteration and thesis evaluation.
                </p>
              </div>
            </section>

            {/* KPI Row */}
            <div className="careloop-page__grid careloop-page__grid--5">
              <div className="careloop-stat-card">
                <span className="careloop-stat-card__value">{fmtNum(s?.session_count)}</span>
                <span className="careloop-stat-card__label">Sessions</span>
              </div>
              <div className="careloop-stat-card">
                <span className="careloop-stat-card__value">{fmtNum(s?.turn_count)}</span>
                <span className="careloop-stat-card__label">Total Turns</span>
              </div>
              <div className="careloop-stat-card">
                <span className="careloop-stat-card__value">{fmtMs(s?.avg_latency_ms)}</span>
                <span className="careloop-stat-card__label">Avg Latency</span>
              </div>
              <div className="careloop-stat-card">
                <span className="careloop-stat-card__value">{fmtMs(s?.median_latency_ms)}</span>
                <span className="careloop-stat-card__label">Median</span>
              </div>
              <div className="careloop-stat-card">
                <span className="careloop-stat-card__value">{fmtMs(s?.p95_latency_ms)}</span>
                <span className="careloop-stat-card__label">P95</span>
              </div>
            </div>

            {/* Activity + Modes */}
            <div className="careloop-page__grid careloop-page__grid--2">
              <section className="careloop-card">
                <h2 className="careloop-card__title">Daily Activity (Last 30 Days)</h2>
                <BarChart data={dailyData} />
              </section>
              <section className="careloop-card">
                <h2 className="careloop-card__title">Coaching Mode Distribution</h2>
                <DonutChart data={modeData} />
              </section>
            </div>

            {/* Latency + Hourly */}
            <div className="careloop-page__grid careloop-page__grid--2">
              <section className="careloop-card">
                <h2 className="careloop-card__title">End-to-End Latency Distribution</h2>
                <LatencyHistogram data={analytics?.latency_distribution ?? []} />
                <div className="careloop-card__stats-row">
                  <span>Min: <strong>{fmtMs(s?.min_latency_ms)}</strong></span>
                  <span>Median: <strong>{fmtMs(s?.median_latency_ms)}</strong></span>
                  <span>P95: <strong>{fmtMs(s?.p95_latency_ms)}</strong></span>
                  <span>Max: <strong>{fmtMs(s?.max_latency_ms)}</strong></span>
                </div>
              </section>
              <section className="careloop-card">
                <h2 className="careloop-card__title">Activity by Hour of Day</h2>
                <HourlyHeatmap data={analytics?.hourly_activity ?? []} />
                <div className="careloop-card__subtitle">Brighter = more messages at that hour</div>
              </section>
            </div>

            {/* Message Lengths + Weekday + Volume */}
            <div className="careloop-page__grid careloop-page__grid--3">
              <section className="careloop-card">
                <h2 className="careloop-card__title">Message Length</h2>
                <MsgLengthChart data={analytics?.msg_length_distribution ?? []} />
              </section>
              <section className="careloop-card">
                <h2 className="careloop-card__title">Activity by Day of Week</h2>
                <WeekdayChart data={analytics?.weekday_activity ?? []} />
              </section>
              <section className="careloop-card">
                <h2 className="careloop-card__title">Volume Summary</h2>
                <div className="careloop-info-grid careloop-info-grid--2x3">
                  <div className="careloop-info-item">
                    <span className="careloop-info-label">User Chars</span>
                    <span className="careloop-info-value">{fmtNum(s?.total_user_chars)}</span>
                  </div>
                  <div className="careloop-info-item">
                    <span className="careloop-info-label">AI Chars</span>
                    <span className="careloop-info-value">{fmtNum(s?.total_assistant_chars)}</span>
                  </div>
                  <div className="careloop-info-item">
                    <span className="careloop-info-label">First Activity</span>
                    <span className="careloop-info-value">{s?.first_activity ? new Date(s.first_activity).toLocaleDateString() : "—"}</span>
                  </div>
                  <div className="careloop-info-item">
                    <span className="careloop-info-label">Last Activity</span>
                    <span className="careloop-info-value">{s?.last_activity ? timeAgo(s.last_activity) : "—"}</span>
                  </div>
                  <div className="careloop-info-item">
                    <span className="careloop-info-label">Avg Turns/Session</span>
                    <span className="careloop-info-value">
                      {s && s.session_count > 0 ? (s.turn_count / s.session_count).toFixed(1) : "—"}
                    </span>
                  </div>
                  <div className="careloop-info-item">
                    <span className="careloop-info-label">Active Days</span>
                    <span className="careloop-info-value">{dailyData.filter((d) => d.value > 0).length}/30</span>
                  </div>
                </div>
              </section>
            </div>

            {/* Personality evolution */}
            {(analytics?.personality_evolution ?? []).length > 1 && (
              <section className="careloop-card">
                <h2 className="careloop-card__title">Personality Trait Evolution</h2>
                <PersonalityTimeline data={analytics!.personality_evolution} />
                <div className="careloop-ocean-legend">
                  {(["O", "C", "E", "A", "N"] as const).map((t) => (
                    <span key={t} className="careloop-ocean-legend__item" style={{ color: OCEAN_COLORS[t] }}>
                      <span className="careloop-ocean-legend__dot" style={{ background: OCEAN_COLORS[t] }} />
                      {OCEAN_NAMES[t]}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* Session detail table */}
            {(analytics?.session_stats ?? []).length > 0 && (
              <section className="careloop-card">
                <h2 className="careloop-card__title">Recent Sessions</h2>
                <div className="careloop-table-wrap">
                  <table className="careloop-table">
                    <thead>
                      <tr>
                        <th>Session</th><th>Date</th><th>Turns</th>
                        <th>Duration</th><th>Avg Latency</th><th>User Chars</th><th>AI Chars</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics!.session_stats.slice(0, 20).map((ss) => (
                        <tr key={ss.session_id} className="careloop-table__clickable"
                          onClick={() => { setTab("sessions"); loadTurns(ss.session_id); }}>
                          <td className="careloop-table__mono">{ss.session_id.slice(0, 8)}…</td>
                          <td>{new Date(ss.created_at).toLocaleDateString()}</td>
                          <td>{ss.turns}</td>
                          <td>{fmtDuration(ss.duration_secs)}</td>
                          <td>{fmtMs(ss.avg_latency)}</td>
                          <td>{fmtNum(ss.user_chars)}</td>
                          <td>{fmtNum(ss.assistant_chars)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Metric Definitions */}
            <section className="careloop-card careloop-text-section">
              <h2 className="careloop-card__title">Metric Definitions</h2>
              <div className="careloop-text-block">
                <div className="careloop-def-grid">
                  <div className="careloop-def-item">
                    <h4>Sessions</h4>
                    <p>A session is a single conversation between the user and CareLoop, identified by a unique UUID. A new session is created each time the user clicks &quot;New Chat&quot; or starts a fresh conversation. Sessions persist across page reloads and are stored in PostgreSQL.</p>
                  </div>
                  <div className="careloop-def-item">
                    <h4>Turns</h4>
                    <p>A turn is one user message + one assistant response pair. Each turn passes through the full 6-stage pipeline (in standard mode) or a direct LLM call (in simple mode). Turn count is the primary indicator of system usage volume.</p>
                  </div>
                  <div className="careloop-def-item">
                    <h4>Average Latency</h4>
                    <p>The arithmetic mean of end-to-end response times across all turns, measured in milliseconds. This includes all pipeline stages: routing, personality detection, RAG retrieval, grounding, LLM generation, and verification. Lower is better for user experience.</p>
                  </div>
                  <div className="careloop-def-item">
                    <h4>Median Latency</h4>
                    <p>The 50th percentile of response times — half of all responses were faster, half were slower. Median is more robust than average because it is not skewed by occasional slow outliers. This is often the best single indicator of typical user experience.</p>
                  </div>
                  <div className="careloop-def-item">
                    <h4>P95 Latency</h4>
                    <p>The 95th percentile — 95% of responses were faster than this value. P95 captures the &quot;worst typical&quot; experience. If P95 is significantly higher than the median, it indicates occasional slow responses, often caused by complex RAG retrieval or LLM generation for detailed queries.</p>
                  </div>
                  <div className="careloop-def-item">
                    <h4>Coaching Modes</h4>
                    <p>CareLoop classifies each user message into one of three coaching modes: <strong>Emotional Support</strong> (empathetic, feeling-focused responses), <strong>Practical Education</strong> (informational, how-to guidance), or <strong>Policy Navigation</strong> (specific IV/AHV/EL regulation lookup with citations). The mode determines which pipeline branch is prioritized.</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Data Interpretation */}
            <section className="careloop-card careloop-text-section">
              <h2 className="careloop-card__title">Interpreting the Data</h2>
              <div className="careloop-text-block">
                {s && s.turn_count > 0 ? (
                  <>
                    <p>
                      Across <strong>{fmtNum(s.session_count)} sessions</strong> and <strong>{fmtNum(s.turn_count)} conversation turns</strong>, the system has processed approximately <strong>{fmtNum(s.total_user_chars)} characters</strong> of user input and generated <strong>{fmtNum(s.total_assistant_chars)} characters</strong> of responses.
                    </p>
                    {s.avg_latency_ms != null && (
                      <p>
                        The average end-to-end latency of <strong>{fmtMs(s.avg_latency_ms)}</strong> (median: <strong>{fmtMs(s.median_latency_ms)}</strong>) indicates {
                          (s.avg_latency_ms ?? 0) < 2000
                            ? "responsive performance well within conversational expectations. Users experience near-real-time responses."
                            : (s.avg_latency_ms ?? 0) < 5000
                              ? "acceptable performance for a multi-stage AI pipeline. Most responses arrive within a few seconds."
                              : "room for optimization. The 6-stage pipeline adds cumulative latency that could impact user experience for time-sensitive queries."
                        }
                        {s.p95_latency_ms != null && s.median_latency_ms != null && s.p95_latency_ms > s.median_latency_ms * 3 && (
                          " The significant gap between median and P95 suggests occasional outlier latencies, likely caused by complex policy retrieval or long LLM generation times."
                        )}
                      </p>
                    )}
                    {s.avg_user_msg_len != null && s.avg_assistant_msg_len != null && (
                      <p>
                        Average user message length of <strong>{fmtNum(s.avg_user_msg_len)} characters</strong> vs. assistant response length of <strong>{fmtNum(s.avg_assistant_msg_len)} characters</strong> shows a response-to-input ratio of approximately <strong>{((s.avg_assistant_msg_len ?? 1) / (s.avg_user_msg_len ?? 1)).toFixed(1)}x</strong>. {
                          (s.avg_assistant_msg_len ?? 0) / (s.avg_user_msg_len ?? 1) > 5
                            ? "The assistant provides substantially detailed responses relative to input — typical for informational and policy navigation queries."
                            : "A balanced response ratio suggests the system is appropriately matching response depth to query complexity."
                        }
                      </p>
                    )}
                    <p>
                      The coaching mode distribution reveals how users are engaging with the system — a high proportion of policy navigation queries validates the system&apos;s primary use case for social insurance guidance, while emotional support queries demonstrate the personality-adaptive features are being utilized for empathetic interactions.
                    </p>
                  </>
                ) : (
                  <p>No conversation data available yet. Start chatting with CareLoop to generate usage analytics and see how the system performs across different coaching modes and personality adaptations.</p>
                )}
              </div>
            </section>
          </>
        )}

        {/* ═══════ PIPELINE TAB ═══════ */}
        {tab === "pipeline" && (
          <>
            {/* Architecture diagram */}
            <section className="careloop-card">
              <h2 className="careloop-card__title">System Architecture</h2>
              <p className="careloop-card__desc">
                CareLoop processes each user message through a 6-stage pipeline orchestrated by n8n, with personality-aware response generation and evidence-based verification.
              </p>
              <ArchitectureDiagram />
            </section>

            {/* Pipeline Performance Table */}
            {pp.length > 0 && (
              <section className="careloop-card">
                <h2 className="careloop-card__title">Pipeline Stage Performance</h2>
                <p className="careloop-card__desc">
                  Measured across {pp[0]?.invocations ?? 0} requests. Each turn passes through all stages sequentially.
                </p>
                <div className="careloop-table-wrap">
                  <table className="careloop-table">
                    <thead>
                      <tr>
                        <th>Stage</th><th>Invocations</th>
                        <th>Avg</th><th>Median</th><th>P95</th><th>Max</th><th>Errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pp.map((p) => (
                        <tr key={p.stage}>
                          <td>
                            <span className="careloop-table__mono">{p.stage}</span>
                          </td>
                          <td>{fmtNum(p.invocations)}</td>
                          <td><strong>{fmtMs(p.avg_ms)}</strong></td>
                          <td>{fmtMs(p.median_ms)}</td>
                          <td>{fmtMs(p.p95_ms)}</td>
                          <td>{fmtMs(p.max_ms)}</td>
                          <td className={p.errors > 0 ? "careloop-table__error" : ""}>
                            {p.errors > 0 ? p.errors : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Pipeline breakdown as stacked bar */}
            {pp.length > 0 && (
              <section className="careloop-card">
                <h2 className="careloop-card__title">Pipeline Breakdown (Avg Latency)</h2>
                <PipelineBreakdown stages={pp} />
              </section>
            )}

            {/* How it works explanation */}
            <section className="careloop-card">
              <h2 className="careloop-card__title">How It Works</h2>
              <div className="careloop-how-grid">
                <HowItem num="1" title="Routing" color="#1e88e5"
                  desc="Classifies user intent into coaching modes: emotional support, practical education, or policy navigation. Determines the response strategy." />
                <HowItem num="2" title="Personality Detection" color="#7c4dff"
                  desc="Analyzes user messages using OCEAN/Big Five model. Applies EMA smoothing to build a stable personality profile across sessions." />
                <HowItem num="3" title="RAG Retrieval" color="#43a047"
                  desc="Searches Swiss social insurance policy database using semantic similarity (pgvector). Retrieves relevant IV, EL, and cantonal regulations." />
                <HowItem num="4" title="Grounding" color="#ff9800"
                  desc="Combines retrieved policies with personality profile and conversation context to create a grounded prompt for the LLM." />
                <HowItem num="5" title="Generation" color="#e53935"
                  desc="Generates a personality-adapted response using the LLM. Adjusts tone, detail level, and empathy based on detected OCEAN traits." />
                <HowItem num="6" title="Verification" color="#00bcd4"
                  desc="Fact-checks the response against retrieved policy sources. Attaches citations and flags any unverifiable claims." />
              </div>
            </section>

            {/* Data stored */}
            <section className="careloop-card">
              <h2 className="careloop-card__title">Data Collected Per Turn</h2>
              <div className="careloop-data-items">
                <DataItem icon="💬" title="Conversation" desc="User message, assistant response, coaching mode, timestamp" />
                <DataItem icon="🧠" title="Personality State" desc="OCEAN scores (O/C/E/A/N), confidence per trait, EMA alpha, stability flag" />
                <DataItem icon="⏱️" title="Performance Metrics" desc="Per-stage latency: routing, detection, retrieval, grounding, generation, verification, end-to-end" />
                <DataItem icon="📄" title="Policy Evidence" desc="Source IDs, chunk IDs, titles, URLs of cited policy documents" />
                <DataItem icon="🔢" title="Embeddings" desc="Vector representations (1024-dim) of semantic memory stored in pgvector for RAG" />
              </div>
            </section>

            {/* Top citations */}
            {(analytics?.top_citations ?? []).length > 0 && (
              <section className="careloop-card">
                <h2 className="careloop-card__title">Top Policy Citations</h2>
                <div className="careloop-citations-list">
                  {analytics!.top_citations.map((c, i) => (
                    <div key={`${c.source_id}-${i}`} className="careloop-citation-row">
                      <span className="careloop-citation-row__rank">#{i + 1}</span>
                      <span className="careloop-citation-row__title">{c.title || c.source_id}</span>
                      <span className="careloop-citation-row__count">{c.cite_count}x</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ═══════ SESSIONS TAB ═══════ */}
        {tab === "sessions" && (
          sessions.length === 0 ? (
            <div className="careloop-card"><p className="careloop-page__empty">No sessions recorded yet.</p></div>
          ) : (
            <div className="careloop-audit-layout">
              <div className="careloop-audit-sessions">
                <h2 className="careloop-card__title">Sessions</h2>
                {sessions.map((ses) => (
                  <button key={ses.session_id} type="button"
                    className={`careloop-audit-session-item ${selectedSession === ses.session_id ? "careloop-audit-session-item--active" : ""}`}
                    onClick={() => loadTurns(ses.session_id)}>
                    <div className="careloop-audit-session-item__top">
                      <span className="careloop-audit-session-item__id">{ses.session_id.slice(0, 8)}…</span>
                      <span className="careloop-audit-session-item__time">{timeAgo(ses.created_at)}</span>
                    </div>
                    <div className="careloop-audit-session-item__bottom">
                      <span>{ses.turn_count} turns</span>
                      {ses.modes?.length > 0 && (
                        <span className={`careloop-badge careloop-badge--sm ${modeBadgeClass(ses.modes[0])}`}>
                          {(ses.modes[0] ?? "").replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <div className="careloop-audit-turns">
                {!selectedSession ? (
                  <div className="careloop-audit-turns__empty">Select a session to view its conversation</div>
                ) : loadingTurns ? (
                  <p className="careloop-page__loading">Loading turns…</p>
                ) : turns.length === 0 ? (
                  <div className="careloop-audit-turns__empty">No turns in this session</div>
                ) : (
                  turns.map((t) => (
                    <div key={t.turn_index} className="careloop-audit-turn">
                      <div className="careloop-audit-turn__header">
                        <span className="careloop-audit-turn__index">#{t.turn_index}</span>
                        {t.mode && (
                          <span className={`careloop-badge careloop-badge--sm ${modeBadgeClass(t.mode)}`}>
                            {t.mode.replace(/_/g, " ")}
                          </span>
                        )}
                        {t.latency_ms != null && (
                          <span className="careloop-audit-turn__latency">{fmtMs(t.latency_ms)}</span>
                        )}
                        <span className="careloop-audit-turn__time">{new Date(t.created_at).toLocaleString()}</span>
                      </div>
                      <div className="careloop-audit-turn__msg careloop-audit-turn__msg--user">
                        <strong>User:</strong> {t.user_msg}
                      </div>
                      {t.assistant_msg && (
                        <div className="careloop-audit-turn__msg careloop-audit-turn__msg--assistant">
                          <strong>Assistant:</strong> {t.assistant_msg}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ── Small sub-components ── */

function PipelineBreakdown({ stages }: { stages: Analytics["pipeline_performance"] }) {
  const filtered = stages.filter((s) => s.stage !== "end_to_end");
  const total = filtered.reduce((s, p) => s + p.avg_ms, 0);
  const stageColors: Record<string, string> = {
    routing: "#1e88e5", detection: "#7c4dff", retrieval: "#43a047",
    grounding: "#ff9800", generation: "#e53935", verification: "#00bcd4",
  };

  return (
    <div className="careloop-pipeline-bar">
      <div className="careloop-pipeline-bar__track">
        {filtered.map((p) => {
          const pct = total > 0 ? (p.avg_ms / total) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <div key={p.stage} className="careloop-pipeline-bar__segment"
              style={{ width: `${pct}%`, background: stageColors[p.stage] ?? "#9e9e9e" }}
              title={`${p.stage}: ${fmtMs(p.avg_ms)} avg (${pct.toFixed(0)}%)`} />
          );
        })}
      </div>
      <div className="careloop-pipeline-bar__legend">
        {filtered.map((p) => {
          const pct = total > 0 ? (p.avg_ms / total) * 100 : 0;
          return (
            <span key={p.stage} className="careloop-pipeline-bar__label">
              <span className="careloop-pipeline-bar__dot" style={{ background: stageColors[p.stage] ?? "#9e9e9e" }} />
              {p.stage} <strong>{fmtMs(p.avg_ms)}</strong> ({pct.toFixed(0)}%)
            </span>
          );
        })}
      </div>
    </div>
  );
}

function HowItem({ num, title, color, desc }: { num: string; title: string; color: string; desc: string }) {
  return (
    <div className="careloop-how-item">
      <div className="careloop-how-item__num" style={{ background: color }}>{num}</div>
      <div className="careloop-how-item__content">
        <h3 className="careloop-how-item__title">{title}</h3>
        <p className="careloop-how-item__desc">{desc}</p>
      </div>
    </div>
  );
}

function DataItem({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="careloop-data-item">
      <span className="careloop-data-item__icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p className="careloop-data-item__desc">{desc}</p>
      </div>
    </div>
  );
}
