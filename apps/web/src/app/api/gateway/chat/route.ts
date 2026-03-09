/**
 * P2 Gateway chat entry point (shadow mode).
 * Accepts gateway envelope (request_id, session_id, user_id?, message, context?, routing_hints?),
 * optionally logs it when GATEWAY_SHADOW_LOG is set, then forwards to /api/chat.
 * Optional auth: GATEWAY_API_KEY; optional rate limit: GATEWAY_RATE_LIMIT_PER_MINUTE (per user_id or IP).
 * See docs/GATEWAY-SHADOW-DESIGN.md.
 */

import { NextRequest, NextResponse } from "next/server";
import { logGatewayShadow, logGatewayShadowResult } from "@/lib/gateway-shadow";
import {
  checkRateLimit,
  getRemaining,
  getClientIp,
} from "@/lib/gateway-rate-limit";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY ?? "";
const GATEWAY_RATE_LIMIT_PER_MINUTE = parseInt(
  process.env.GATEWAY_RATE_LIMIT_PER_MINUTE ?? "0",
  10
);
const GATEWAY_MAX_INFLIGHT = parseInt(process.env.GATEWAY_MAX_INFLIGHT ?? "30", 10);
const GATEWAY_FORWARD_TIMEOUT_MS = parseInt(
  process.env.GATEWAY_FORWARD_TIMEOUT_MS ?? "25000",
  10
);
let inFlightForwards = 0;

function requireGatewayAuth(request: NextRequest): NextResponse | null {
  if (!GATEWAY_API_KEY) return null;
  const key = request.headers.get("x-api-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (key !== GATEWAY_API_KEY) {
    return NextResponse.json({ error: "Unauthorized. Provide x-api-key or Authorization: Bearer." }, { status: 401 });
  }
  return null;
}

function generateRequestId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/gateway/chat",
    method: "POST",
    hint: "Gateway envelope: { request_id?, session_id, user_id?, message, context?, routing_hints? }. Forwards to /api/chat. GATEWAY_SHADOW_LOG to log; GATEWAY_API_KEY for auth; GATEWAY_RATE_LIMIT_PER_MINUTE for rate limit.",
  });
}

function buildGatewayBusyFallback(params: {
  session_id: string;
  request_id: string;
  reason: "gateway_busy" | "gateway_timeout" | "gateway_forward_failed";
}) {
  return {
    session_id: params.session_id,
    message: {
      role: "assistant",
      content:
        "I am here with you. The system is experiencing high traffic, so I will respond briefly now and continue once load stabilizes. Please share your top priority for this moment.",
      timestamp: new Date().toISOString(),
    },
    personality_state: {
      ocean: { O: 0, C: 0, E: 0, A: 0, N: 0 },
      stable: false,
      confidence: { O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 },
      ema_applied: false,
    },
    policy_navigation: {
      active: false,
      citations: [],
      grounding: { status: "skipped", score: 1, claims_detected: 0, claims_grounded: 0 },
    },
    regulation: {
      directives: ["Be warm, attentive, and supportive"],
      zurich_applied: true,
    },
    pipeline_status: {
      detector: "skipped",
      generator: "fallback",
      verifier: "ok",
      retrieval: "skipped",
      grounding: "skipped",
      fact_invariance_check: "pass",
    },
    coaching_mode: "emotional_support",
    mode_confidence: 0.6,
    request_id: params.request_id,
    debug: {
      gateway_degraded: true,
      gateway_degraded_reason: params.reason,
    },
  };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const authError = requireGatewayAuth(request);
  if (authError) return authError;

  let body: {
    request_id?: string;
    session_id?: string;
    user_id?: string;
    message?: string;
    messages?: Array<{
      role?: string;
      content?: string;
      coaching_mode?: string;
      session_routing?: {
        route_key?: string;
        isolation_scope?: "mode_lane" | "session";
      };
    }>;
    context?: { canton?: string; language?: string };
    routing_hints?: {
      force_policy_mode?: boolean;
      model_tier?: "light" | "medium" | "heavy";
      workflow?: "simple";
      target_mode?: "emotional_support" | "practical_education" | "policy_navigation" | "mixed";
      route_key?: string;
      isolation_scope?: "mode_lane" | "session";
    };
    turn_index?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sessionId = body?.session_id;
  const message = body?.message ?? "";
  const rateLimitKey =
    (body?.user_id && typeof body.user_id === "string" ? body.user_id : null) ||
    getClientIp(request);
  if (!checkRateLimit(rateLimitKey, GATEWAY_RATE_LIMIT_PER_MINUTE)) {
    const retryAfter = 60;
    return NextResponse.json(
      {
        error: "Too many requests. Retry after a minute.",
        retry_after_seconds: retryAfter,
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      }
    );
  }

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json({ error: "Missing or invalid session_id." }, { status: 400 });
  }
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session_id format (UUID required)." }, { status: 400 });
  }

  const request_id = body?.request_id ?? request.headers.get("x-request-id") ?? generateRequestId();
  const envelope = {
    request_id,
    session_id: sessionId,
    user_id: body?.user_id,
    message,
    context: body?.context,
    routing_hints: body?.routing_hints,
  };
  logGatewayShadow(envelope);

  const tier = body?.routing_hints?.model_tier;
  const validTier =
    tier === "light" || tier === "medium" || tier === "heavy" ? tier : "medium";
  const useSimpleWorkflow =
    body?.routing_hints?.workflow === "simple" || validTier === "light";
  const chatBody = {
    request_id,
    session_id: sessionId,
    turn_index: body?.turn_index ?? 1,
    message,
    messages: Array.isArray(body?.messages) ? body.messages : undefined,
    context: {
      ...(body?.context ?? { language: "en", canton: "ZH" }),
      model_tier: validTier,
    },
    routing_hints: {
      ...(body?.routing_hints ?? {}),
      model_tier: validTier,
      workflow: useSimpleWorkflow ? "simple" as const : undefined,
    },
    ...(useSimpleWorkflow ? { workflow: "simple" as const } : {}),
  };

  const origin = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl?.origin || "http://localhost:3000";
  const chatUrl = `${origin}/api/chat`;

  if (GATEWAY_MAX_INFLIGHT > 0 && inFlightForwards >= GATEWAY_MAX_INFLIGHT) {
    const fallback = buildGatewayBusyFallback({
      session_id: sessionId,
      request_id,
      reason: "gateway_busy",
    });
    logGatewayShadowResult({
      request_id,
      session_id: sessionId,
      status_code: 200,
      latency_ms: Date.now() - startedAt,
      has_error_envelope: false,
      error_code: "gateway_busy_fallback",
    });
    return NextResponse.json(fallback, { status: 200 });
  }

  inFlightForwards++;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GATEWAY_FORWARD_TIMEOUT_MS);
    const res = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-request-id": request_id },
      body: JSON.stringify(chatBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));
    const hasErrorEnvelope =
      data && typeof data === "object" && (data as { success?: unknown }).success === false;
    const errorCode =
      hasErrorEnvelope &&
      data &&
      typeof data === "object" &&
      typeof (data as { error?: { error_code?: unknown } }).error?.error_code === "string"
        ? (data as { error: { error_code: string } }).error.error_code
        : undefined;
    logGatewayShadowResult({
      request_id,
      session_id: sessionId,
      status_code: res.status,
      latency_ms: Date.now() - startedAt,
      has_error_envelope: hasErrorEnvelope,
      error_code: errorCode,
    });
    const headers: Record<string, string> = {};
    if (GATEWAY_RATE_LIMIT_PER_MINUTE > 0) {
      const remaining = getRemaining(rateLimitKey, GATEWAY_RATE_LIMIT_PER_MINUTE);
      if (remaining !== undefined) headers["X-RateLimit-Remaining"] = String(remaining);
    }
    return NextResponse.json(data, { status: res.status, headers });
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "AbortError";
    if (isTimeout) {
      const fallback = buildGatewayBusyFallback({
        session_id: sessionId,
        request_id,
        reason: "gateway_timeout",
      });
      logGatewayShadowResult({
        request_id,
        session_id: sessionId,
        status_code: 200,
        latency_ms: Date.now() - startedAt,
        has_error_envelope: false,
        error_code: "gateway_timeout_fallback",
      });
      return NextResponse.json(fallback, { status: 200 });
    }
    const message = e instanceof Error ? e.message : "Gateway forward failed";
    const fallback = buildGatewayBusyFallback({
      session_id: sessionId,
      request_id,
      reason: "gateway_forward_failed",
    });
    logGatewayShadowResult({
      request_id,
      session_id: sessionId,
      status_code: 200,
      latency_ms: Date.now() - startedAt,
      has_error_envelope: false,
      error_code: "gateway_forward_failed_fallback",
    });
    return NextResponse.json({
      ...fallback,
      debug: {
        ...(fallback.debug ?? {}),
        gateway_forward_message: message,
      },
    }, { status: 200 });
  } finally {
    inFlightForwards = Math.max(0, inFlightForwards - 1);
  }
}
