"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/components/AuthProvider";

/* ── Constants ── */
const TRAITS = ["O", "C", "E", "A", "N"] as const;
type Trait = (typeof TRAITS)[number];

const TRAIT_NAMES: Record<string, string> = {
  O: "Openness", C: "Conscientiousness", E: "Extraversion", A: "Agreeableness", N: "Neuroticism",
};

const TRAIT_COLORS: Record<string, string> = {
  O: "#7c4dff", C: "#00bcd4", E: "#ff9800", A: "#4caf50", N: "#f44336",
};

const TRAIT_FACETS: Record<string, { high: string; low: string; icon: string; keywords_high: string[]; keywords_low: string[] }> = {
  O: {
    high: "Curious, creative, open to new experiences, enjoys novelty and exploration",
    low: "Practical, conventional, prefers routine, values familiarity and tradition",
    icon: "🎨",
    keywords_high: ["curious", "creative", "explore", "try", "imagine", "idea", "new", "different"],
    keywords_low: ["practical", "usual", "routine", "traditional", "familiar", "standard"],
  },
  C: {
    high: "Organized, disciplined, reliable, goal-oriented, plans ahead carefully",
    low: "Flexible, spontaneous, adaptable, prefers going with the flow",
    icon: "📋",
    keywords_high: ["plan", "organize", "schedule", "goal", "deadline", "structured", "systematic"],
    keywords_low: ["flexible", "spontaneous", "whatever", "relax", "easy", "casual"],
  },
  E: {
    high: "Outgoing, energetic, sociable, draws energy from social interaction",
    low: "Reserved, reflective, independent, prefers solitude or small groups",
    icon: "🗣️",
    keywords_high: ["friends", "together", "social", "party", "group", "talk", "people", "fun"],
    keywords_low: ["alone", "quiet", "private", "myself", "calm", "solitude", "peaceful"],
  },
  A: {
    high: "Cooperative, trusting, empathetic, warm, values harmony in relationships",
    low: "Analytical, objective, direct, straightforward, values honesty over tact",
    icon: "🤝",
    keywords_high: ["help", "care", "kind", "support", "thank", "grateful", "appreciate", "together"],
    keywords_low: ["disagree", "wrong", "argue", "prove", "fact", "debate", "challenge"],
  },
  N: {
    high: "Sensitive, emotionally aware, reactive, experiences strong feelings",
    low: "Calm, stable, resilient, handles stress with equanimity",
    icon: "💭",
    keywords_high: ["worried", "anxious", "stress", "afraid", "overwhelmed", "sad", "nervous", "scared"],
    keywords_low: ["calm", "stable", "fine", "good", "confident", "secure", "relaxed"],
  },
};

const REGULATION_MAP: Record<string, { high: string; low: string }> = {
  O: { high: "Invite exploration, suggest alternatives, use varied metaphors", low: "Focus on familiar topics, reduce novelty, give concrete steps" },
  C: { high: "Provide organized, structured guidance with clear action items", low: "Keep flexible, relaxed, and spontaneous in tone" },
  E: { high: "Maintain an energetic, sociable tone with encouragement", low: "Adopt a calm, low-key style with reflective space" },
  A: { high: "Show warmth, empathy, and collaboration in responses", low: "Use a neutral, matter-of-fact stance with direct advice" },
  N: { high: "Offer extra comfort, acknowledge anxieties, validate feelings", low: "Reassure stability and confidence, keep tone steady" },
};

const EMA_ALPHA = 0.3;
const CROSS_SESSION_ALPHA = 0.2;
const STABILITY_MIN_TURNS = 20;
const STABILITY_VARIANCE = 0.03;

/* ── Types ── */
type Profile = {
  ocean_scores: Record<string, number>;
  confidence: Record<string, number>;
  total_turns: number;
  stable: boolean;
};

type HistoryPoint = {
  session_id: string;
  turn_index: number;
  ocean_json: Record<string, number>;
  confidence_json: Record<string, number>;
  stable: boolean;
  created_at: string;
};

/* ── Helpers ── */
function norm(v: number) { return Math.max(0, Math.min(100, ((v + 1) / 2) * 100)); }

function traitLevel(v: number): "high" | "mid" | "low" {
  if (v > 0.2) return "high";
  if (v < -0.2) return "low";
  return "mid";
}

function pctStr(v: number) { return `${(v * 100).toFixed(0)}%`; }

/* ── SVG Components ── */
function OceanRadar({ ocean, size = 260 }: { ocean: Record<string, number>; size?: number }) {
  const cx = size / 2, cy = size / 2, r = size * 0.36;
  const rings = [0.25, 0.5, 0.75, 1.0];
  const angleStep = (2 * Math.PI) / TRAITS.length;
  const startAngle = -Math.PI / 2;

  const getPoint = (index: number, value: number) => {
    const angle = startAngle + index * angleStep;
    const dist = r * ((value + 1) / 2);
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
  };

  const dataPoints = TRAITS.map((t, i) => getPoint(i, ocean[t] ?? 0));
  const polygon = dataPoints.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="careloop-radar">
      {rings.map((ring) => (
        <polygon key={ring}
          points={TRAITS.map((_, i) => {
            const angle = startAngle + i * angleStep;
            const d = r * ring;
            return `${cx + d * Math.cos(angle)},${cy + d * Math.sin(angle)}`;
          }).join(" ")}
          fill="none" stroke="var(--color-border)" strokeWidth="1" opacity={0.4} />
      ))}
      {TRAITS.map((_, i) => {
        const angle = startAngle + i * angleStep;
        return <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle)} y2={cy + r * Math.sin(angle)}
          stroke="var(--color-border)" strokeWidth="1" opacity={0.25} />;
      })}
      <polygon points={polygon} fill="var(--color-primary)" fillOpacity={0.15}
        stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" />
      {dataPoints.map((p, i) => (
        <circle key={TRAITS[i]} cx={p.x} cy={p.y} r={5}
          fill={TRAIT_COLORS[TRAITS[i]]} stroke="#fff" strokeWidth="2" />
      ))}
      {TRAITS.map((t, i) => {
        const angle = startAngle + i * angleStep;
        const lx = cx + (r + 24) * Math.cos(angle);
        const ly = cy + (r + 24) * Math.sin(angle);
        const val = ocean[t] ?? 0;
        return (
          <g key={`label-${t}`}>
            <text x={lx} y={ly - 7} textAnchor="middle" dominantBaseline="middle"
              fill={TRAIT_COLORS[t]} fontSize="13" fontWeight="700">{t}</text>
            <text x={lx} y={ly + 8} textAnchor="middle" dominantBaseline="middle"
              fill="var(--color-text-muted)" fontSize="9">{val.toFixed(2)}</text>
          </g>
        );
      })}
      <text x={cx} y={14} textAnchor="middle" fill="var(--color-text-muted)" fontSize="8">+1.0</text>
      <text x={cx} y={cy + 4} textAnchor="middle" fill="var(--color-border)" fontSize="8">0</text>
    </svg>
  );
}

function TraitTimeline({ history, trait }: { history: HistoryPoint[]; trait: Trait }) {
  if (history.length < 2) return <p className="careloop-chart__empty">Need more data</p>;
  const values = history.map((h) => h.ocean_json[trait] ?? 0);
  const w = 340, h = 80, pad = 6;
  const stepX = (w - pad * 2) / Math.max(values.length - 1, 1);

  const points = values.map((v, i) => ({
    x: pad + i * stepX,
    y: pad + ((1 - v) / 2) * (h - pad * 2),
  }));

  const area = `M${points[0].x},${h - pad} L${points.map((p) => `${p.x},${p.y}`).join(" L")} L${points[points.length - 1].x},${h - pad} Z`;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="careloop-chart-svg">
      <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2}
        stroke="var(--color-border)" strokeWidth="0.5" strokeDasharray="3 3" />
      <path d={area} fill={TRAIT_COLORS[trait]} fillOpacity={0.08} />
      <path d={line} fill="none" stroke={TRAIT_COLORS[trait]} strokeWidth="2" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3.5}
        fill={TRAIT_COLORS[trait]} stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

function ConfidenceGauge({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const w = 60, h = 8;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <rect x={0} y={0} width={w} height={h} rx={4} fill="var(--color-surface-alt)" />
      <rect x={0} y={0} width={w * (pct / 100)} height={h} rx={4} fill={color} opacity={0.7} />
    </svg>
  );
}

/* ── Main Component ── */
type Tab = "profile" | "detection" | "regulation";

export default function PersonalityPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      fetch("/api/personality/profile").then((r) => r.json()),
      fetch("/api/personality/history").then((r) => r.json()).catch(() => ({ history: [] })),
    ])
      .then(([profileData, historyData]) => {
        setProfile(profileData?.profile ?? null);
        const h = Array.isArray(historyData?.history) ? historyData.history : [];
        setHistory(h.filter((p: HistoryPoint) =>
          TRAITS.some((t) => (p.ocean_json?.[t] ?? 0) !== 0)
        ));
      })
      .finally(() => setLoading(false));
  }, [user]);

  const dominantTrait = useMemo(() => {
    if (!profile) return null;
    let max = -Infinity, best: Trait = "O";
    for (const t of TRAITS) {
      const abs = Math.abs(profile.ocean_scores[t] ?? 0);
      if (abs > max) { max = abs; best = t; }
    }
    return best;
  }, [profile]);

  const activeDirectives = useMemo(() => {
    if (!profile) return [];
    return TRAITS.map((t) => {
      const v = profile.ocean_scores[t] ?? 0;
      const level = traitLevel(v);
      if (level === "mid") return null;
      return {
        trait: t,
        level,
        directive: level === "high" ? REGULATION_MAP[t].high : REGULATION_MAP[t].low,
      };
    }).filter(Boolean) as { trait: Trait; level: "high" | "low"; directive: string }[];
  }, [profile]);

  const profileSummary = useMemo(() => {
    if (!profile) return "";
    const scores = profile.ocean_scores;
    const lines: string[] = [];

    const highTraits = TRAITS.filter((t) => (scores[t] ?? 0) > 0.2);
    const lowTraits = TRAITS.filter((t) => (scores[t] ?? 0) < -0.2);
    const midTraits = TRAITS.filter((t) => Math.abs(scores[t] ?? 0) <= 0.2);

    if (highTraits.length === 0 && lowTraits.length === 0) {
      return "Your personality profile is currently balanced across all five OCEAN dimensions. No strong trait tendencies have emerged yet — continue chatting to refine the model.";
    }

    if (highTraits.length > 0) {
      lines.push(`You show elevated scores in ${highTraits.map((t) => TRAIT_NAMES[t]).join(", ")}, which means the assistant will adapt its communication style to match — ${highTraits.map((t) => TRAIT_FACETS[t].high.split(",")[0].toLowerCase()).join(", ")}.`);
    }
    if (lowTraits.length > 0) {
      lines.push(`Lower scores in ${lowTraits.map((t) => TRAIT_NAMES[t]).join(", ")} indicate preferences for ${lowTraits.map((t) => TRAIT_FACETS[t].low.split(",")[0].toLowerCase()).join(", ")}.`);
    }
    if (midTraits.length > 0) {
      lines.push(`${midTraits.map((t) => TRAIT_NAMES[t]).join(", ")} ${midTraits.length === 1 ? "is" : "are"} in the balanced range, so no specific regulation is applied for ${midTraits.length === 1 ? "this trait" : "these traits"}.`);
    }

    lines.push(`Based on ${profile.total_turns} analyzed turns, ${activeDirectives.length} regulation directive${activeDirectives.length === 1 ? " is" : "s are"} currently active. The profile is ${profile.stable ? "stable — trait scores have converged and the system is confident in the personality model" : "still learning — more conversations will refine the accuracy"}.`);

    return lines.join(" ");
  }, [profile, activeDirectives]);

  if (loading) {
    return (
      <div className="careloop-page">
        <div className="careloop-page__header"><h1>Personality Analysis</h1></div>
        <div className="careloop-page__content"><p className="careloop-page__loading">Loading…</p></div>
      </div>
    );
  }

  return (
    <div className="careloop-page">
      <div className="careloop-page__header">
        <h1>Personality Analysis</h1>
        <p className="careloop-page__subtitle">
          OCEAN personality detection, regulation directives, and profile synthesis
        </p>
        <div className="careloop-page__tabs">
          <button type="button" className={`careloop-page__tab ${tab === "profile" ? "careloop-page__tab--active" : ""}`}
            onClick={() => setTab("profile")}>Profile Summary</button>
          <button type="button" className={`careloop-page__tab ${tab === "detection" ? "careloop-page__tab--active" : ""}`}
            onClick={() => setTab("detection")}>Detection</button>
          <button type="button" className={`careloop-page__tab ${tab === "regulation" ? "careloop-page__tab--active" : ""}`}
            onClick={() => setTab("regulation")}>Regulation</button>
        </div>
      </div>

      <div className="careloop-page__content">
        {!profile ? (
          <section className="careloop-card">
            <p className="careloop-page__empty">No personality data yet. Start chatting to build your profile.</p>
          </section>
        ) : (
          <>
            {/* ═══════ PROFILE SUMMARY TAB ═══════ */}
            {tab === "profile" && (
              <>
                {/* Project Overview */}
                <section className="careloop-card careloop-text-section">
                  <h2 className="careloop-card__title">About CareLoop Personality System</h2>
                  <div className="careloop-text-block">
                    <p>
                      CareLoop is a personality-aware conversational assistant designed for Swiss social insurance navigation. It uses the <strong>Big Five / OCEAN model</strong> — the most widely validated personality framework in psychology — to understand each user&apos;s communication style and adapt responses accordingly.
                    </p>
                    <p>
                      The system operates on a core thesis: <em>social insurance information is more effectively communicated when adapted to the recipient&apos;s personality traits</em>. A highly neurotic user who is anxious about their IV application receives more empathetic, reassuring responses, while a highly conscientious user receives structured, action-oriented guidance.
                    </p>
                    <p>
                      Unlike static personality tests, CareLoop performs <strong>continuous, implicit detection</strong> — analyzing natural conversation text rather than requiring users to fill out questionnaires. The personality profile is built incrementally across multiple sessions and smoothed using exponential moving averages to ensure stability and accuracy.
                    </p>
                  </div>
                </section>

                {/* Methodology */}
                <section className="careloop-card careloop-text-section">
                  <h2 className="careloop-card__title">Methodology: OCEAN / Big Five Model</h2>
                  <div className="careloop-text-block">
                    <p>
                      The <strong>Big Five</strong> (also called OCEAN) is the dominant taxonomy in personality psychology, with decades of cross-cultural validation. It describes personality along five orthogonal dimensions, each scored on a continuous scale from -1.0 (low) to +1.0 (high):
                    </p>
                    <div className="careloop-method-grid">
                      {TRAITS.map((t) => (
                        <div key={t} className="careloop-method-item" style={{ borderLeftColor: TRAIT_COLORS[t] }}>
                          <div className="careloop-method-item__head">
                            <span>{TRAIT_FACETS[t].icon}</span>
                            <strong style={{ color: TRAIT_COLORS[t] }}>{TRAIT_NAMES[t]} ({t})</strong>
                          </div>
                          <p><strong>High:</strong> {TRAIT_FACETS[t].high}</p>
                          <p><strong>Low:</strong> {TRAIT_FACETS[t].low}</p>
                        </div>
                      ))}
                    </div>
                    <p>
                      CareLoop detects these traits through <strong>lexical analysis</strong> (keyword pattern matching), <strong>linguistic feature extraction</strong> (message length, punctuation patterns, sentiment ratios), and <strong>contextual inference</strong>. The raw per-message estimates are smoothed using a two-stage EMA process: intra-session (&#945; = {EMA_ALPHA}) for short-term stability, and cross-session (&#945; = {CROSS_SESSION_ALPHA}) for long-term profile synthesis.
                    </p>
                    <p>
                      A <strong>confidence score</strong> (0–100%) accompanies each trait, reflecting how certain the system is about the estimate. Low-confidence readings (below 30%) are automatically discarded to prevent noisy measurements from corrupting the stable profile. After {STABILITY_MIN_TURNS}+ turns with variance below {STABILITY_VARIANCE}, the profile is marked &quot;stable.&quot;
                    </p>
                  </div>
                </section>

                {/* KPI Row */}
                <div className="careloop-page__grid careloop-page__grid--4">
                  <div className="careloop-stat-card">
                    <span className="careloop-stat-card__value">{profile.total_turns}</span>
                    <span className="careloop-stat-card__label">Turns Analyzed</span>
                  </div>
                  <div className="careloop-stat-card">
                    <span className={`careloop-stat-card__value ${profile.stable ? "careloop-stat-card__value--success" : ""}`}>
                      {profile.stable ? "Stable" : "Learning"}
                    </span>
                    <span className="careloop-stat-card__label">Profile Status</span>
                  </div>
                  <div className="careloop-stat-card">
                    <span className="careloop-stat-card__value" style={{ color: TRAIT_COLORS[dominantTrait ?? "O"] }}>
                      {TRAIT_NAMES[dominantTrait ?? "O"]}
                    </span>
                    <span className="careloop-stat-card__label">Dominant Trait</span>
                  </div>
                  <div className="careloop-stat-card">
                    <span className="careloop-stat-card__value">{activeDirectives.length}</span>
                    <span className="careloop-stat-card__label">Active Directives</span>
                  </div>
                </div>

                {/* Written summary */}
                <section className="careloop-card">
                  <h2 className="careloop-card__title">Profile Summary</h2>
                  <p className="careloop-personality-summary">{profileSummary}</p>
                  <div className="careloop-personality-tags">
                    {TRAITS.map((t) => {
                      const v = profile.ocean_scores[t] ?? 0;
                      const level = traitLevel(v);
                      return (
                        <span key={t} className={`careloop-ptag careloop-ptag--${level}`}
                          style={{ borderColor: TRAIT_COLORS[t] }}>
                          <span className="careloop-ptag__icon">{TRAIT_FACETS[t].icon}</span>
                          <span className="careloop-ptag__name">{TRAIT_NAMES[t]}</span>
                          <span className="careloop-ptag__level">{level === "high" ? "High" : level === "low" ? "Low" : "Mid"}</span>
                        </span>
                      );
                    })}
                  </div>
                </section>

                {/* Radar + Trait Bars */}
                <div className="careloop-page__grid careloop-page__grid--2">
                  <section className="careloop-card careloop-card--center">
                    <h2 className="careloop-card__title">OCEAN Radar</h2>
                    <OceanRadar ocean={profile.ocean_scores} />
                    <div className="careloop-card__meta">
                      <span className={`careloop-badge ${profile.stable ? "careloop-badge--stable" : "careloop-badge--learning"}`}>
                        {profile.stable ? "Stable" : "Learning"}
                      </span>
                      <span className="careloop-card__meta-text">{profile.total_turns} turns</span>
                    </div>
                  </section>

                  <section className="careloop-card">
                    <h2 className="careloop-card__title">Trait Scores & Confidence</h2>
                    {TRAITS.map((t) => {
                      const val = profile.ocean_scores[t] ?? 0;
                      const conf = profile.confidence[t] ?? 0;
                      const pct = norm(val);
                      const level = traitLevel(val);
                      return (
                        <div key={t} className="careloop-trait-detail">
                          <div className="careloop-trait-detail__header">
                            <span className="careloop-trait-detail__icon">{TRAIT_FACETS[t].icon}</span>
                            <span style={{ color: TRAIT_COLORS[t], fontWeight: 600, flex: 1 }}>{TRAIT_NAMES[t]}</span>
                            <span className="careloop-trait-detail__score">{val.toFixed(2)}</span>
                            <ConfidenceGauge value={conf} color={TRAIT_COLORS[t]} />
                            <span className="careloop-trait-detail__conf">{pctStr(conf)}</span>
                          </div>
                          <div className="careloop-trait__bar">
                            <div className="careloop-trait__bar-fill" style={{ width: `${pct}%`, background: TRAIT_COLORS[t] }} />
                            <div className="careloop-trait__bar-mid" />
                          </div>
                          <p className="careloop-trait-detail__desc">
                            {level === "high" ? TRAIT_FACETS[t].high : level === "low" ? TRAIT_FACETS[t].low : "Balanced — moderate expression of this trait"}
                          </p>
                        </div>
                      );
                    })}
                  </section>
                </div>

                {/* Trait History */}
                {history.length > 1 && (
                  <section className="careloop-card">
                    <h2 className="careloop-card__title">Trait Evolution Over Time</h2>
                    <p className="careloop-card__desc">How each OCEAN trait has changed across {history.length} personality measurements</p>
                    <div className="careloop-history-grid">
                      {TRAITS.map((t) => (
                        <div key={t} className="careloop-history-item">
                          <div className="careloop-history-item__head">
                            <span className="careloop-history-item__label" style={{ color: TRAIT_COLORS[t] }}>
                              {TRAIT_FACETS[t].icon} {TRAIT_NAMES[t]}
                            </span>
                            <span className="careloop-history-item__current">
                              {(profile.ocean_scores[t] ?? 0).toFixed(2)}
                            </span>
                          </div>
                          <TraitTimeline history={history} trait={t} />
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Stability progress */}
                <section className="careloop-card">
                  <h2 className="careloop-card__title">Stability Progress</h2>
                  <p className="careloop-card__desc">
                    Profile becomes &quot;stable&quot; after {STABILITY_MIN_TURNS} turns with trait variance below {STABILITY_VARIANCE}
                  </p>
                  <div className="careloop-stability">
                    <div className="careloop-stability__bar-wrap">
                      <div className="careloop-stability__bar">
                        <div className="careloop-stability__bar-fill"
                          style={{ width: `${Math.min(100, (profile.total_turns / STABILITY_MIN_TURNS) * 100)}%` }} />
                      </div>
                      <span className="careloop-stability__label">
                        {profile.total_turns}/{STABILITY_MIN_TURNS} turns
                        {profile.total_turns >= STABILITY_MIN_TURNS ? " ✓" : ""}
                      </span>
                    </div>
                    <div className="careloop-stability__status">
                      {profile.stable ? (
                        <span className="careloop-badge careloop-badge--stable">Profile is stable — traits are consistent</span>
                      ) : profile.total_turns >= STABILITY_MIN_TURNS ? (
                        <span className="careloop-badge careloop-badge--learning">Enough turns, but traits are still shifting</span>
                      ) : (
                        <span className="careloop-badge careloop-badge--learning">
                          {STABILITY_MIN_TURNS - profile.total_turns} more turns needed for stability check
                        </span>
                      )}
                    </div>
                  </div>
                </section>

                {/* Metric Definitions */}
                <section className="careloop-card careloop-text-section">
                  <h2 className="careloop-card__title">Understanding the Metrics</h2>
                  <div className="careloop-text-block">
                    <div className="careloop-def-grid">
                      <div className="careloop-def-item">
                        <h4>Trait Score (-1.0 to +1.0)</h4>
                        <p>Each OCEAN dimension is measured on a continuous scale. Scores above +0.2 are classified as &quot;high,&quot; below -0.2 as &quot;low,&quot; and between as &quot;mid&quot; (balanced). The score represents the cumulative, smoothed estimate from all analyzed conversations.</p>
                      </div>
                      <div className="careloop-def-item">
                        <h4>Confidence (0–100%)</h4>
                        <p>Reflects how certain the system is about a trait estimate. Higher confidence means more consistent signals across messages. Confidence increases as more conversation turns provide trait-relevant signals. Readings below 30% confidence are automatically discarded.</p>
                      </div>
                      <div className="careloop-def-item">
                        <h4>EMA Smoothing</h4>
                        <p>Exponential Moving Average prevents single messages from disproportionately shifting the profile. Intra-session EMA (&#945;=0.3) smooths within a conversation; cross-session EMA (&#945;=0.2) smooths across sessions. This means older data gradually fades while recent data is weighted more.</p>
                      </div>
                      <div className="careloop-def-item">
                        <h4>Stability Flag</h4>
                        <p>A profile is &quot;stable&quot; when: (1) at least {STABILITY_MIN_TURNS} turns have been analyzed, AND (2) the average squared change between consecutive updates is below {STABILITY_VARIANCE}. Stable profiles use lower LLM temperature (0.55 vs 0.70) for more consistent responses.</p>
                      </div>
                      <div className="careloop-def-item">
                        <h4>Regulation Directives</h4>
                        <p>Natural-language instructions injected into the LLM system prompt. Only traits with &quot;high&quot; or &quot;low&quot; classification generate directives. Mid-range traits use default behavior. Directives shape tone, empathy level, structure, and communication style.</p>
                      </div>
                      <div className="careloop-def-item">
                        <h4>Turns Analyzed</h4>
                        <p>The total number of conversation turns (user messages) that have contributed to the personality profile. Not every turn produces trait signals — messages like greetings or simple acknowledgments may not shift scores. Quality of signal matters more than quantity.</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Per-Trait Deep Interpretation */}
                <section className="careloop-card careloop-text-section">
                  <h2 className="careloop-card__title">Your Trait Interpretation</h2>
                  <div className="careloop-text-block">
                    {TRAITS.map((t) => {
                      const val = profile.ocean_scores[t] ?? 0;
                      const conf = profile.confidence[t] ?? 0;
                      const level = traitLevel(val);
                      return (
                        <div key={t} className="careloop-interp" style={{ borderLeftColor: TRAIT_COLORS[t] }}>
                          <h4>
                            {TRAIT_FACETS[t].icon}{" "}
                            <span style={{ color: TRAIT_COLORS[t] }}>{TRAIT_NAMES[t]}</span>
                            {" "}— Score: {val.toFixed(2)} | Confidence: {pctStr(conf)} | Classification: {level.toUpperCase()}
                          </h4>
                          {level === "high" && t === "O" && <p>Your high Openness suggests you are receptive to new ideas and creative approaches. The assistant will present multiple perspectives, suggest alternative solutions, and use varied examples and metaphors to engage your curiosity. You may prefer exploratory conversations over rigid step-by-step instructions.</p>}
                          {level === "low" && t === "O" && <p>Your lower Openness indicates a preference for practical, concrete information over abstract exploration. The assistant will focus on familiar frameworks, use straightforward language, and provide specific, actionable steps rather than open-ended suggestions.</p>}
                          {level === "mid" && t === "O" && <p>Your Openness is in the balanced range. You likely appreciate both creative exploration and practical solutions depending on context. No specific adjustment is applied — the assistant will naturally balance novelty with concreteness based on the conversation topic.</p>}

                          {level === "high" && t === "C" && <p>Your high Conscientiousness reflects a preference for organized, systematic communication. The assistant will provide numbered steps, clear timelines, action items, and structured formats. It will emphasize deadlines, procedures, and thorough coverage of requirements.</p>}
                          {level === "low" && t === "C" && <p>Your lower Conscientiousness suggests you prefer flexibility over rigid structure. The assistant will adopt a more relaxed, conversational tone — giving guidance without excessive detail or overwhelming checklists. Key points will be highlighted without micromanagement.</p>}
                          {level === "mid" && t === "C" && <p>Your Conscientiousness is balanced. You can work with both structured and flexible formats. The assistant will provide moderate structure — enough to be helpful without being overwhelming.</p>}

                          {level === "high" && t === "E" && <p>Your high Extraversion suggests you draw energy from interaction and prefer an engaging, upbeat communication style. The assistant will use an enthusiastic, encouraging tone with social warmth. It may suggest collaborative approaches and frame information positively.</p>}
                          {level === "low" && t === "E" && <p>Your lower Extraversion indicates a preference for calm, measured communication. The assistant will adopt a quieter, more reflective style — giving you space to process information without excessive enthusiasm or social pressure. Responses will be thorough but understated.</p>}
                          {level === "mid" && t === "E" && <p>Your Extraversion is balanced. The assistant will use a moderate, professional tone that is neither overly enthusiastic nor excessively reserved. It adapts naturally to the energy level of each conversation.</p>}

                          {level === "high" && t === "A" && <p>Your high Agreeableness reflects warmth and a cooperative orientation. The assistant will respond with empathy, validation, and collaborative language. It will frame suggestions gently, acknowledge your feelings, and prioritize supportive communication over blunt directness.</p>}
                          {level === "low" && t === "A" && <p>Your lower Agreeableness suggests you prefer direct, no-nonsense communication. The assistant will adopt a more matter-of-fact tone — presenting information objectively without excessive emotional framing. It will focus on facts, logic, and efficient problem-solving.</p>}
                          {level === "mid" && t === "A" && <p>Your Agreeableness is in the balanced range. The assistant will blend empathetic acknowledgment with straightforward information delivery, adapting based on the emotional context of each message.</p>}

                          {level === "high" && t === "N" && <p>Your elevated Neuroticism indicates heightened emotional sensitivity. The assistant will provide extra reassurance, explicitly acknowledge your concerns, and validate your feelings before offering guidance. Complex processes will be broken down into smaller, less overwhelming steps. The tone will be calming and supportive.</p>}
                          {level === "low" && t === "N" && <p>Your lower Neuroticism reflects emotional stability and resilience. The assistant will communicate with confidence, present information efficiently, and avoid unnecessary hedging or over-cautious language. It trusts your ability to handle information directly.</p>}
                          {level === "mid" && t === "N" && <p>Your Neuroticism is balanced. The assistant will maintain a steady, professional tone — acknowledging challenges without overemphasizing them, and providing reassurance when contextually appropriate.</p>}
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Summary & Implications */}
                <section className="careloop-card careloop-text-section">
                  <h2 className="careloop-card__title">Summary & Practical Implications</h2>
                  <div className="careloop-text-block">
                    <p>
                      Your current personality profile has been synthesized from <strong>{profile.total_turns} conversation turns</strong> using a two-stage EMA smoothing process. The profile is currently <strong>{profile.stable ? "stable" : "in the learning phase"}</strong>.
                    </p>
                    {activeDirectives.length > 0 ? (
                      <>
                        <p>Based on your trait scores, <strong>{activeDirectives.length} regulation directive{activeDirectives.length > 1 ? "s" : ""}</strong> {activeDirectives.length > 1 ? "are" : "is"} actively shaping the assistant&apos;s responses:</p>
                        <ul className="careloop-text-list">
                          {activeDirectives.map((d) => (
                            <li key={d.trait}>
                              <strong>{TRAIT_NAMES[d.trait]}</strong> ({d.level}): {d.directive}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p>No regulation directives are currently active — all traits are in the balanced range. The assistant is using its default communication style. Continue conversing to refine the profile and potentially activate personality-specific adaptations.</p>
                    )}
                    <p>
                      The personality system is designed to make social insurance information more accessible by adapting to <em>how</em> you prefer to receive information. It does not judge or categorize — there are no &quot;good&quot; or &quot;bad&quot; trait scores. Every personality configuration leads to different adaptive strategies that aim to improve comprehension and emotional comfort.
                    </p>
                    {!profile.stable && (
                      <p className="careloop-text-note">
                        <strong>Note:</strong> Your profile is still learning. Trait scores may shift significantly as more data is collected. For the most accurate personality adaptation, aim for at least {STABILITY_MIN_TURNS} meaningful conversation turns across multiple sessions.
                      </p>
                    )}
                  </div>
                </section>
              </>
            )}

            {/* ═══════ DETECTION TAB ═══════ */}
            {tab === "detection" && (
              <>
                {/* How detection works */}
                <section className="careloop-card">
                  <h2 className="careloop-card__title">How Personality Detection Works</h2>
                  <p className="careloop-card__desc">
                    Every user message is analyzed through a multi-signal heuristic + LLM pipeline to estimate Big Five (OCEAN) personality traits.
                  </p>
                  <div className="careloop-detection-flow">
                    <div className="careloop-dflow-step">
                      <div className="careloop-dflow-step__num" style={{ background: "#1e88e5" }}>1</div>
                      <div className="careloop-dflow-step__content">
                        <h3>Heuristic Analysis</h3>
                        <p>Scans user text for trait-indicative keywords: emotional words (N), social language (E), planning/structure words (C), curiosity markers (O), and cooperative language (A).</p>
                      </div>
                    </div>
                    <div className="careloop-dflow-step">
                      <div className="careloop-dflow-step__num" style={{ background: "#7c4dff" }}>2</div>
                      <div className="careloop-dflow-step__content">
                        <h3>Signal Extraction</h3>
                        <p>Extracts linguistic signals: message length, question marks, exclamation marks, positive/negative word ratios, social references, and structural indicators.</p>
                      </div>
                    </div>
                    <div className="careloop-dflow-step">
                      <div className="careloop-dflow-step__num" style={{ background: "#ff9800" }}>3</div>
                      <div className="careloop-dflow-step__content">
                        <h3>EMA Smoothing (Intra-Session)</h3>
                        <p>Applies Exponential Moving Average (&#945; = {EMA_ALPHA}) within the session to smooth trait values: <code>new = &#945; &times; current + (1-&#945;) &times; previous</code>. Prevents single-message spikes from distorting the profile.</p>
                      </div>
                    </div>
                    <div className="careloop-dflow-step">
                      <div className="careloop-dflow-step__num" style={{ background: "#43a047" }}>4</div>
                      <div className="careloop-dflow-step__content">
                        <h3>Cross-Session Synthesis</h3>
                        <p>Merges session results into the stable profile using a separate EMA (&#945; = {CROSS_SESSION_ALPHA}). Low-confidence scores (below 30%) are discarded to avoid noise.</p>
                      </div>
                    </div>
                    <div className="careloop-dflow-step">
                      <div className="careloop-dflow-step__num" style={{ background: "#e53935" }}>5</div>
                      <div className="careloop-dflow-step__content">
                        <h3>Stability Assessment</h3>
                        <p>After {STABILITY_MIN_TURNS}+ turns, if trait variance between updates drops below {STABILITY_VARIANCE}, the profile is marked &quot;stable&quot; — meaning the system is confident in the personality model.</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Detection signals per trait */}
                <section className="careloop-card">
                  <h2 className="careloop-card__title">Detection Signals by Trait</h2>
                  <p className="careloop-card__desc">Keyword patterns and linguistic features used to estimate each OCEAN dimension</p>
                  <div className="careloop-signals-grid">
                    {TRAITS.map((t) => {
                      const val = profile.ocean_scores[t] ?? 0;
                      const conf = profile.confidence[t] ?? 0;
                      const level = traitLevel(val);
                      return (
                        <div key={t} className="careloop-signal-card" style={{ borderLeftColor: TRAIT_COLORS[t] }}>
                          <div className="careloop-signal-card__header">
                            <span className="careloop-signal-card__icon">{TRAIT_FACETS[t].icon}</span>
                            <span className="careloop-signal-card__name" style={{ color: TRAIT_COLORS[t] }}>{TRAIT_NAMES[t]}</span>
                            <span className={`careloop-badge careloop-badge--sm careloop-badge--${level === "high" ? "stable" : level === "low" ? "emotional" : "learning"}`}>
                              {val.toFixed(2)} ({level})
                            </span>
                          </div>
                          <div className="careloop-signal-card__body">
                            <div className="careloop-signal-card__section">
                              <span className="careloop-signal-card__label">High indicators:</span>
                              <div className="careloop-signal-keywords">
                                {TRAIT_FACETS[t].keywords_high.map((k) => (
                                  <span key={k} className="careloop-keyword careloop-keyword--high">{k}</span>
                                ))}
                              </div>
                            </div>
                            <div className="careloop-signal-card__section">
                              <span className="careloop-signal-card__label">Low indicators:</span>
                              <div className="careloop-signal-keywords">
                                {TRAIT_FACETS[t].keywords_low.map((k) => (
                                  <span key={k} className="careloop-keyword careloop-keyword--low">{k}</span>
                                ))}
                              </div>
                            </div>
                            <div className="careloop-signal-card__footer">
                              <span>Confidence: <strong>{pctStr(conf)}</strong></span>
                              <ConfidenceGauge value={conf} color={TRAIT_COLORS[t]} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* EMA formula visualization */}
                <section className="careloop-card">
                  <h2 className="careloop-card__title">EMA Smoothing Algorithm</h2>
                  <div className="careloop-formula-grid">
                    <div className="careloop-formula-card">
                      <h3>Intra-Session (per turn)</h3>
                      <div className="careloop-formula">
                        smoothed<sub>t</sub> = &#945; &times; raw<sub>t</sub> + (1 - &#945;) &times; smoothed<sub>t-1</sub>
                      </div>
                      <p className="careloop-formula__detail">&#945; = {EMA_ALPHA} — recent messages have 30% weight, prior state has 70% weight</p>
                    </div>
                    <div className="careloop-formula-card">
                      <h3>Cross-Session (profile update)</h3>
                      <div className="careloop-formula">
                        profile<sub>new</sub> = &#946; &times; session<sub>end</sub> + (1 - &#946;) &times; profile<sub>old</sub>
                      </div>
                      <p className="careloop-formula__detail">&#946; = {CROSS_SESSION_ALPHA} — each session contributes 20% to the stable profile</p>
                    </div>
                    <div className="careloop-formula-card">
                      <h3>Low-Confidence Gate</h3>
                      <div className="careloop-formula">
                        if confidence &lt; 0.3 → keep previous value
                      </div>
                      <p className="careloop-formula__detail">Prevents noisy or ambiguous messages from shifting the profile</p>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* ═══════ REGULATION TAB ═══════ */}
            {tab === "regulation" && (
              <>
                {/* Active directives */}
                <section className="careloop-card">
                  <h2 className="careloop-card__title">Active Regulation Directives</h2>
                  <p className="careloop-card__desc">
                    Based on your personality profile, these directives are currently applied to shape the assistant&apos;s responses:
                  </p>
                  {activeDirectives.length === 0 ? (
                    <p className="careloop-page__empty">No strong trait signals yet — responses use a balanced default tone.</p>
                  ) : (
                    <div className="careloop-directives">
                      {activeDirectives.map((d) => (
                        <div key={d.trait} className="careloop-directive" style={{ borderLeftColor: TRAIT_COLORS[d.trait] }}>
                          <div className="careloop-directive__header">
                            <span className="careloop-directive__icon">{TRAIT_FACETS[d.trait].icon}</span>
                            <span className="careloop-directive__trait" style={{ color: TRAIT_COLORS[d.trait] }}>
                              {TRAIT_NAMES[d.trait]}
                            </span>
                            <span className={`careloop-badge careloop-badge--sm ${d.level === "high" ? "careloop-badge--stable" : "careloop-badge--emotional"}`}>
                              {d.level}
                            </span>
                          </div>
                          <p className="careloop-directive__text">{d.directive}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Full regulation map */}
                <section className="careloop-card">
                  <h2 className="careloop-card__title">Complete Regulation Map</h2>
                  <p className="careloop-card__desc">
                    How each trait level maps to specific response behavior. Active directives are highlighted.
                  </p>
                  <div className="careloop-table-wrap">
                    <table className="careloop-table">
                      <thead>
                        <tr>
                          <th>Trait</th>
                          <th>Your Score</th>
                          <th>High → Directive</th>
                          <th>Low → Directive</th>
                        </tr>
                      </thead>
                      <tbody>
                        {TRAITS.map((t) => {
                          const val = profile.ocean_scores[t] ?? 0;
                          const level = traitLevel(val);
                          return (
                            <tr key={t}>
                              <td>
                                <span style={{ color: TRAIT_COLORS[t], fontWeight: 600 }}>
                                  {TRAIT_FACETS[t].icon} {TRAIT_NAMES[t]}
                                </span>
                              </td>
                              <td>
                                <span className={`careloop-badge careloop-badge--sm ${level === "high" ? "careloop-badge--stable" : level === "low" ? "careloop-badge--emotional" : "careloop-badge--learning"}`}>
                                  {val.toFixed(2)}
                                </span>
                              </td>
                              <td className={level === "high" ? "careloop-table__highlight" : ""}>
                                {REGULATION_MAP[t].high}
                              </td>
                              <td className={level === "low" ? "careloop-table__highlight" : ""}>
                                {REGULATION_MAP[t].low}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* How regulation works */}
                <section className="careloop-card">
                  <h2 className="careloop-card__title">How Regulation Works</h2>
                  <div className="careloop-how-grid careloop-how-grid--2">
                    <div className="careloop-how-item">
                      <div className="careloop-how-item__num" style={{ background: "#1e88e5" }}>1</div>
                      <div className="careloop-how-item__content">
                        <h3 className="careloop-how-item__title">Trait Thresholding</h3>
                        <p className="careloop-how-item__desc">Each OCEAN score is classified as high (&gt; 0.2), low (&lt; -0.2), or mid. Only high/low traits generate directives.</p>
                      </div>
                    </div>
                    <div className="careloop-how-item">
                      <div className="careloop-how-item__num" style={{ background: "#7c4dff" }}>2</div>
                      <div className="careloop-how-item__content">
                        <h3 className="careloop-how-item__title">Directive Generation</h3>
                        <p className="careloop-how-item__desc">Active traits produce natural-language directives that are injected into the LLM system prompt to shape tone, style, and empathy level.</p>
                      </div>
                    </div>
                    <div className="careloop-how-item">
                      <div className="careloop-how-item__num" style={{ background: "#ff9800" }}>3</div>
                      <div className="careloop-how-item__content">
                        <h3 className="careloop-how-item__title">Coaching Mode Integration</h3>
                        <p className="careloop-how-item__desc">Directives are combined with the coaching mode (emotional / practical / policy) to create a context-appropriate response strategy.</p>
                      </div>
                    </div>
                    <div className="careloop-how-item">
                      <div className="careloop-how-item__num" style={{ background: "#43a047" }}>4</div>
                      <div className="careloop-how-item__content">
                        <h3 className="careloop-how-item__title">Stable vs Dynamic</h3>
                        <p className="careloop-how-item__desc">Stable profiles use lower temperature ({0.55}) for consistent responses. Learning profiles use higher temperature ({0.7}) for exploration.</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Example prompts */}
                <section className="careloop-card">
                  <h2 className="careloop-card__title">Generated System Prompt Fragment</h2>
                  <p className="careloop-card__desc">This is what gets injected into the LLM based on your current profile:</p>
                  <div className="careloop-prompt-preview">
                    <code className="careloop-prompt-code">
                      {activeDirectives.length > 0 ? (
                        <>
                          {"## Personality-Adapted Behavior\n"}
                          {"The user's personality profile indicates:\n"}
                          {activeDirectives.map((d) =>
                            `- ${TRAIT_NAMES[d.trait]} is ${d.level}: ${d.directive}\n`
                          ).join("")}
                          {"\nApply these directives to your response style, "}
                          {"tone, and level of detail.\n"}
                          {`Temperature: ${profile.stable ? "0.55 (stable)" : "0.70 (dynamic)"}`}
                        </>
                      ) : (
                        "No personality directives active — using balanced default behavior."
                      )}
                    </code>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
