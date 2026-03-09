#!/usr/bin/env node
/**
 * P2-9 Retrieval regression: run multiple policy cases from a JSON file (or default list).
 * Usage: node scripts/retrieval-regression-runner.js [path-to-cases.json]
 * Cases format:
 * [ { case_id, message, context?, messages?, routing_hints?, require_policy_mode?, expected_coaching_mode?, min_citations?, max_citations?, require_route_key?, expected_route_suffix?, max_elapsed_ms?, max_retrieval_ms?, max_regeneration_ms? } ].
 * Each case gets a new session; we assert content + citations and optional routing expectations.
 * Emits one JSONL telemetry line (job_type retrieval_regression) to BACKGROUND_JOB_LOG_PATH or stdout.
 * Exit 0 if all pass, 1 if any fail. See docs/BACKGROUND-JOBS-DESIGN.md, PILLAR-TEST-MATRIX-EXECUTION.md.
 */

const BASE_URL = process.env.BASE_URL || process.env.CARELOOP_BASE_URL || "http://localhost:3003";
const LOG_PATH = process.env.BACKGROUND_JOB_LOG_PATH || "";
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.RETRIEVAL_REGRESSION_TIMEOUT_MS || "45000", 10);
const fs = require("fs");
const path = require("path");
const { appendFile } = require("fs").promises;

const DEFAULT_CASES = [
  {
    case_id: "pn-smoke-1",
    message: "What are the eligibility conditions for IV (Invalidity Insurance) in Switzerland?",
    context: { language: "en", canton: "ZH" },
    require_policy_mode: true,
    min_citations: 1,
  },
  {
    case_id: "pn-smoke-2",
    message: "How do I register for IV?",
    context: { language: "en", canton: "ZH" },
    require_policy_mode: true,
    min_citations: 1,
  },
];

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function loadCases(filePath) {
  if (!filePath) return DEFAULT_CASES;
  const raw = fs.readFileSync(path.resolve(filePath), "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) return DEFAULT_CASES;
  return arr
    .filter((c) => c && typeof c.case_id === "string" && typeof c.message === "string")
    .map((c) => ({
      case_id: c.case_id,
      message: c.message,
      context: c.context,
      messages: Array.isArray(c.messages)
        ? c.messages
            .filter((m) => m && typeof m.role === "string" && typeof m.content === "string")
            .map((m) => ({
              role: m.role,
              content: m.content,
              coaching_mode: typeof m.coaching_mode === "string" ? m.coaching_mode : undefined,
              session_routing:
                m.session_routing && typeof m.session_routing === "object"
                  ? {
                      route_key: typeof m.session_routing.route_key === "string" ? m.session_routing.route_key : undefined,
                      isolation_scope:
                        m.session_routing.isolation_scope === "mode_lane" || m.session_routing.isolation_scope === "session"
                          ? m.session_routing.isolation_scope
                          : undefined,
                    }
                  : undefined,
            }))
        : undefined,
      routing_hints:
        c.routing_hints && typeof c.routing_hints === "object"
          ? {
              target_mode:
                typeof c.routing_hints.target_mode === "string" ? c.routing_hints.target_mode : undefined,
              route_key:
                typeof c.routing_hints.route_key === "string" ? c.routing_hints.route_key : undefined,
              isolation_scope:
                c.routing_hints.isolation_scope === "mode_lane" || c.routing_hints.isolation_scope === "session"
                  ? c.routing_hints.isolation_scope
                  : undefined,
            }
          : undefined,
      require_policy_mode: c.require_policy_mode === true,
      expected_coaching_mode: typeof c.expected_coaching_mode === "string" ? c.expected_coaching_mode : undefined,
      min_citations: Number.isInteger(c.min_citations) ? c.min_citations : undefined,
      max_citations: Number.isInteger(c.max_citations) ? c.max_citations : undefined,
      require_route_key: c.require_route_key === true,
      expected_route_suffix: typeof c.expected_route_suffix === "string" ? c.expected_route_suffix : undefined,
      max_elapsed_ms: Number.isInteger(c.max_elapsed_ms) ? c.max_elapsed_ms : undefined,
      max_retrieval_ms: Number.isInteger(c.max_retrieval_ms) ? c.max_retrieval_ms : undefined,
      max_regeneration_ms: Number.isInteger(c.max_regeneration_ms) ? c.max_regeneration_ms : undefined,
    }));
}

function isPolicyMode(mode) {
  return mode === "policy_navigation" || mode === "mixed";
}

async function runOneCase(
  baseUrl,
  {
    case_id,
    message,
    context,
    messages,
    routing_hints,
    require_policy_mode,
    expected_coaching_mode,
    min_citations,
    max_citations,
    require_route_key,
    expected_route_suffix,
    max_elapsed_ms,
    max_retrieval_ms,
    max_regeneration_ms,
  }
) {
  const sessionId = uuid();
  const resolvedRouteKey =
    typeof routing_hints?.route_key === "string"
      ? routing_hints.route_key.replace(/\{session_id\}/g, sessionId)
      : undefined;
  const body = {
    session_id: sessionId,
    turn_index: 1,
    message,
    context: context || { language: "en", canton: "ZH" },
    messages: Array.isArray(messages) ? messages.map((m) => ({
      ...m,
      session_routing: m.session_routing?.route_key
        ? {
            ...m.session_routing,
            route_key: m.session_routing.route_key.replace(/\{session_id\}/g, sessionId),
          }
        : m.session_routing,
    })) : undefined,
    routing_hints: routing_hints
      ? {
          ...routing_hints,
          route_key: resolvedRouteKey,
        }
      : undefined,
  };
  let has_content = false;
  let has_citations = false;
  let error_code = null;
  let http_status = null;
  let coaching_mode = null;
  let citation_count = 0;
  let route_key = null;
  let elapsed_ms = 0;
  let retrieval_ms = null;
  let regeneration_ms = null;
  const startedAt = Date.now();

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    http_status = res.status;
    const data = await res.json().catch(() => ({}));
    elapsed_ms = Date.now() - startedAt;

    if (!res.ok) {
      error_code = `http_${res.status}`;
      return { case_id, pass: false, error_code, http_status, elapsed_ms };
    }
    if (data && data.success === false && data.error) {
      error_code = data.error.error_code || "pipeline_error";
      return { case_id, pass: false, error_code, http_status, elapsed_ms };
    }

    const content = data?.message?.content ?? data?.reply ?? "";
    has_content = typeof content === "string" && content.length > 0;
    const citations =
      data?.citations ??
      data?.policy_evidence ??
      data?.policy_navigation?.citations ??
      data?.message?.citations ??
      [];
    citation_count = Array.isArray(citations) ? citations.length : 0;
    const requiredCitations = Number.isInteger(min_citations) ? min_citations : 1;
    has_citations = citation_count >= requiredCitations;
    const maxCitationsOk = Number.isInteger(max_citations) ? citation_count <= max_citations : true;
    coaching_mode = typeof data?.coaching_mode === "string" ? data.coaching_mode : typeof data?.message?.coaching_mode === "string" ? data.message.coaching_mode : null;
    route_key =
      typeof data?.session_routing?.route_key === "string"
        ? data.session_routing.route_key
        : null;
    retrieval_ms =
      typeof data?.retrieval_timing?.total_ms === "number" ? data.retrieval_timing.total_ms : null;
    regeneration_ms =
      typeof data?.debug?.regeneration_ms === "number" ? data.debug.regeneration_ms : null;
    const policyModeRequired = require_policy_mode || expected_coaching_mode === "policy_navigation" || expected_coaching_mode === "mixed";
    const mode_ok = expected_coaching_mode
      ? coaching_mode === expected_coaching_mode
      : policyModeRequired
        ? isPolicyMode(coaching_mode)
        : true;
    const route_ok =
      require_route_key || expected_route_suffix
        ? Boolean(route_key) &&
          (!expected_route_suffix || String(route_key).endsWith(expected_route_suffix.replace(/\{session_id\}/g, sessionId)))
        : true;
    const latency_ok =
      !Number.isInteger(max_elapsed_ms) || elapsed_ms <= max_elapsed_ms;
    const retrieval_ok =
      !Number.isInteger(max_retrieval_ms) ||
      (typeof retrieval_ms === "number" && retrieval_ms <= max_retrieval_ms);
    const regeneration_ok =
      !Number.isInteger(max_regeneration_ms) ||
      (typeof regeneration_ms === "number" && regeneration_ms <= max_regeneration_ms);

    if (!has_content) error_code = "no_content";
    else if (!has_citations) error_code = "no_citations";
    else if (!maxCitationsOk) error_code = "too_many_citations";
    else if (!mode_ok) error_code = "unexpected_coaching_mode";
    else if (!route_ok) error_code = "unexpected_route_key";
    else if (!latency_ok) error_code = "elapsed_ms_exceeded";
    else if (!retrieval_ok) error_code = "retrieval_ms_exceeded";
    else if (!regeneration_ok) error_code = "regeneration_ms_exceeded";

    return {
      case_id,
      pass:
        has_content &&
        has_citations &&
        maxCitationsOk &&
        mode_ok &&
        route_ok &&
        latency_ok &&
        retrieval_ok &&
        regeneration_ok,
      error_code: error_code || undefined,
      http_status,
      coaching_mode: coaching_mode || undefined,
      citation_count,
      route_key: route_key || undefined,
      elapsed_ms,
      retrieval_ms: retrieval_ms ?? undefined,
      regeneration_ms: regeneration_ms ?? undefined,
    };
  } catch (e) {
    const error_code =
      e && (e.name === "TimeoutError" || e.name === "AbortError") ? "request_timeout" : "request_failed";
    return { case_id, pass: false, error_code, http_status: null, elapsed_ms: Date.now() - startedAt };
  }
}

function percentile(values, p) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[idx];
}

async function run() {
  const casesPath = process.argv[2];
  const cases = loadCases(casesPath);
  const job_id = `retrieval-regression-${Date.now()}`;
  const startedAt = Date.now();

  const results = [];
  for (const c of cases) {
    const r = await runOneCase(BASE_URL, c);
    results.push(r);
  }

  const duration_ms = Date.now() - startedAt;
  const pass_count = results.filter((r) => r.pass).length;
  const fail_count = results.length - pass_count;
  const status = fail_count === 0 ? "ok" : "fail";
  const elapsedValues = results
    .map((r) => r.elapsed_ms)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const retrievalValues = results
    .map((r) => r.retrieval_ms)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const regenerationValues = results
    .map((r) => r.regeneration_ms)
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  const failures = results
    .filter((r) => !r.pass)
    .map((r) => ({
      case_id: r.case_id,
      error_code: r.error_code,
      coaching_mode: r.coaching_mode,
      citation_count: r.citation_count,
      route_key: r.route_key,
      elapsed_ms: r.elapsed_ms,
      retrieval_ms: r.retrieval_ms,
      regeneration_ms: r.regeneration_ms,
    }));

  const payload = {
    job_id,
    job_type: "retrieval_regression",
    stage: "background_job",
    status,
    duration_ms,
    total: cases.length,
    pass_count,
    fail_count,
    latency_ms: elapsedValues.length
      ? {
          p50: percentile(elapsedValues, 0.5),
          p95: percentile(elapsedValues, 0.95),
          p99: percentile(elapsedValues, 0.99),
        }
      : undefined,
    retrieval_ms: retrievalValues.length
      ? {
          p50: percentile(retrievalValues, 0.5),
          p95: percentile(retrievalValues, 0.95),
        }
      : undefined,
    regeneration_ms: regenerationValues.length
      ? {
          p50: percentile(regenerationValues, 0.5),
          p95: percentile(regenerationValues, 0.95),
        }
      : undefined,
    failures: failures.length ? failures : undefined,
    created_at: new Date().toISOString(),
  };

  const line = JSON.stringify(payload) + "\n";
  if (LOG_PATH) {
    await appendFile(LOG_PATH, line).catch(() => process.stdout.write(line));
  } else {
    process.stdout.write(line);
  }

  if (fail_count > 0) {
    process.stderr.write(`retrieval-regression: ${pass_count}/${cases.length} passed; failures: ${JSON.stringify(failures)}\n`);
  }

  process.exit(status === "ok" ? 0 : 1);
}

run().catch((e) => {
  process.stderr.write(String(e));
  process.exit(1);
});
