import { NextRequest, NextResponse } from "next/server";
import type { ErrorCode, ErrorStage } from "@big5loop/contracts";
import { ERROR_CODES } from "@big5loop/contracts";
import { getSessionUser } from "@/lib/auth";
import { auditTurn, buildAuditPayload } from "@/lib/audit";
import { writeAuditToDb } from "@/lib/audit-db";
import { writeStageTimingsToDb } from "@/lib/performance-metrics";
import { retrievePolicyEvidence } from "@/lib/retrieval";
import type { RetrievalResult } from "@/lib/retrieval";
import {
  generateLLMResponse,
  buildSystemPrompt,
  isLLMAvailable,
} from "@/lib/llm";
import type { LLMMessage } from "@/lib/llm";

const VALID_ERROR_CODES = new Set<string>(ERROR_CODES);
function isErrorCode(s: unknown): s is ErrorCode {
  return typeof s === "string" && VALID_ERROR_CODES.has(s);
}

export const dynamic = "force-dynamic";

function errorResponse(
  error_code: ErrorCode,
  message: string,
  status: number,
  options?: { stage?: ErrorStage; retryable?: boolean; session_id?: string; request_id?: string; fallback_content?: string }
): NextResponse {
  const envelope = {
    success: false as const,
    error: {
      error_code,
      message,
      stage: options?.stage ?? "unknown",
      retryable: options?.retryable ?? false,
      session_id: options?.session_id,
      request_id: options?.request_id,
    },
    fallback_content: options?.fallback_content,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(envelope, { status });
}

const WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL || process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL || "http://localhost:5678";
const N8N_TIMEOUT_MS = Number.parseInt(process.env.N8N_TIMEOUT_MS ?? "60000", 10);
const API_LLM_REGEN_TIMEOUT_MS = Number.parseInt(
  process.env.API_LLM_REGEN_TIMEOUT_MS ?? "8000",
  10
);
const API_LLM_REGEN_MIN_CONTENT_CHARS = Number.parseInt(
  process.env.API_LLM_REGEN_MIN_CONTENT_CHARS ?? "160",
  10
);
const LLM_ROUTER_TIMEOUT_MS = Number.parseInt(
  process.env.LLM_ROUTER_TIMEOUT_MS ?? "6000",
  10
);
const LLM_ROUTER_CACHE_TTL_MS = Number.parseInt(
  process.env.LLM_ROUTER_CACHE_TTL_MS ?? "300000",
  10
);
const LLM_ROUTER_MIN_CONFIDENCE = Number.parseFloat(
  process.env.LLM_ROUTER_MIN_CONFIDENCE ?? "0.5"
);

const POLICY_KEYWORDS = [
  "benefit", "benefits", "eligibility", "eligible", "procedure", "policy",
  "official", "form", "forms", "document", "documents", "source", "sources",
  "deadline", "deadlines", "allowance", "invalidenversicherung", "iv", "el",
  "zurich", "canton", "spitex", "ahv", "supplementary", "social",
  "insurance", "registration", "disability", "caregiver",
];
const EDUCATION_KEYWORDS = [
  "how to", "steps", "step-by-step", "plan", "routine", "practice",
  "technique", "guide", "learn", "checklist", "method", "prioritize",
  "actionable", "next steps", "manage", "organize", "tips",
];
const EMOTIONAL_KEYWORDS = [
  "feel", "feeling", "stressed", "anxious", "anxiety", "overwhelmed",
  "sad", "worried", "burned out", "panic", "lonely", "lost", "scared", "afraid",
  "reassurance", "cope", "help me",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKeyword(lowerText: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (/^[a-z0-9]+$/.test(kw) && kw.length <= 3) {
    const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i");
    return re.test(lowerText);
  }
  return lowerText.includes(kw);
}

function scoreByKeywords(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((score, keyword) => (hasKeyword(lower, keyword) ? score + 1 : score), 0);
}

function getKeywordScores(text: string): { policy: number; education: number; emotional: number } {
  return {
    policy: scoreByKeywords(text, POLICY_KEYWORDS),
    education: scoreByKeywords(text, EDUCATION_KEYWORDS),
    emotional: scoreByKeywords(text, EMOTIONAL_KEYWORDS),
  };
}

function hasPolicyOptOut(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("do not need policy") ||
    lower.includes("don't need policy") ||
    lower.includes("no policy information") ||
    lower.includes("not policy information") ||
    lower.includes("without policy") ||
    lower.includes("no citations") ||
    lower.includes("without citations")
  );
}

/**
 * Fallback intent inference for the current message alone.
 */
function inferCoachingModeFallback(message: string): "emotional_support" | "practical_education" | "policy_navigation" | "mixed" {
  const policyScore = scoreByKeywords(message, POLICY_KEYWORDS);
  const educationScore = scoreByKeywords(message, EDUCATION_KEYWORDS);
  const emotionalScore = scoreByKeywords(message, EMOTIONAL_KEYWORDS);

  if (policyScore > 0 && emotionalScore > 0) return "mixed";
  if (policyScore >= Math.max(educationScore, emotionalScore) && policyScore > 0) return "policy_navigation";
  if (educationScore >= emotionalScore && educationScore > 0) return "practical_education";
  return "emotional_support";
}

interface ConversationMessage {
  role: string;
  content: string;
  coaching_mode?: string;
  session_routing?: {
    route_key?: string;
    isolation_scope?: "mode_lane" | "session";
  };
}

type CoachingMode =
  | "emotional_support"
  | "practical_education"
  | "policy_navigation"
  | "mixed";

type RoutingHints = {
  route_key?: string;
  target_mode?: CoachingMode;
  isolation_scope?: "mode_lane" | "session";
  workflow?: "simple";
};

type RoutingDecision = {
  coaching_mode: CoachingMode;
  mode_confidence: number;
  needs_retrieval: boolean;
  routing_reason: string;
  source: "requested" | "llm" | "llm_cache" | "heuristic";
  llm_duration_ms?: number;
};

const llmRoutingCache = new Map<string, { expires_at: number; decision: RoutingDecision }>();

function isCoachingMode(value: unknown): value is CoachingMode {
  return (
    value === "emotional_support" ||
    value === "practical_education" ||
    value === "policy_navigation" ||
    value === "mixed"
  );
}

function buildRouteKey(sessionId: string, mode: CoachingMode): string {
  return `${sessionId}:${mode}`;
}

function getConversationRouteKey(message: ConversationMessage): string | undefined {
  if (typeof message.session_routing?.route_key === "string" && message.session_routing.route_key.trim()) {
    return message.session_routing.route_key.trim();
  }
  if (isCoachingMode(message.coaching_mode)) {
    return message.coaching_mode;
  }
  return undefined;
}

function isolateConversationHistory(
  conversationHistory: ConversationMessage[],
  requestedRouteKey?: string
): { history: ConversationMessage[]; historyFiltered: boolean } {
  if (!requestedRouteKey) {
    return { history: conversationHistory, historyFiltered: false };
  }

  const matching = conversationHistory.filter((message) => {
    const key = getConversationRouteKey(message);
    return Boolean(key) && (key === requestedRouteKey || requestedRouteKey.endsWith(`:${key}`));
  });
  if (matching.length >= 2) {
    return { history: matching, historyFiltered: true };
  }

  return { history: conversationHistory, historyFiltered: false };
}

/**
 * Context-aware intent inference: for short follow-up messages (e.g. "tell me more"),
 * look at the recent conversation to maintain topic continuity.
 */
function inferIntentWithHistory(
  currentMessage: string,
  conversationHistory: ConversationMessage[]
): "emotional_support" | "practical_education" | "policy_navigation" | "mixed" {
  const directIntent = inferCoachingModeFallback(currentMessage);

  // If the current message has clear keywords, trust them
  if (directIntent !== "emotional_support") return directIntent;

  // For short / ambiguous follow-ups, inherit topic from recent conversation
  const wordCount = currentMessage.trim().split(/\s+/).length;
  const isShortFollowUp = wordCount <= 10;
  if (!isShortFollowUp || conversationHistory.length === 0) return directIntent;

  // Check if recent conversation was about policy or education
  const recentText = conversationHistory
    .slice(-6)
    .map((m) => m.content)
    .join(" ");
  const recentPolicyScore = scoreByKeywords(recentText, POLICY_KEYWORDS);
  const recentEducationScore = scoreByKeywords(recentText, EDUCATION_KEYWORDS);

  if (recentPolicyScore >= 3) return "policy_navigation";
  if (recentEducationScore >= 3) return "practical_education";

  return directIntent;
}

/**
 * Extract the last user message about policy from conversation history.
 * Used as the retrieval query when the current message is a vague follow-up.
 */
function getRetrievalQuery(
  currentMessage: string,
  conversationHistory: ConversationMessage[]
): string {
  const directPolicyScore = scoreByKeywords(currentMessage, POLICY_KEYWORDS);
  if (directPolicyScore >= 2 || currentMessage.trim().split(/\s+/).length > 10) {
    return currentMessage;
  }

  // For short follow-ups, find the last substantive user message about policy
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const msg = conversationHistory[i];
    if (msg.role !== "user") continue;
    const score = scoreByKeywords(msg.content, POLICY_KEYWORDS);
    if (score >= 1 && msg.content.trim().split(/\s+/).length > 5) {
      return msg.content;
    }
  }

  return currentMessage;
}

function shouldRetrieveEvidence(
  mode: CoachingMode,
  currentMessage: string,
  conversationHistory: ConversationMessage[]
): boolean {
  if (hasPolicyOptOut(currentMessage)) return false;
  if (mode === "policy_navigation" || mode === "mixed") return true;
  if (mode !== "practical_education") return false;

  const directScores = getKeywordScores(currentMessage);
  if (directScores.policy > 0) return true;

  const recentText = conversationHistory
    .slice(-4)
    .map((message) => message.content)
    .join(" ");
  return scoreByKeywords(recentText, POLICY_KEYWORDS) >= 3;
}

function getAssistantContent(data: Record<string, unknown>): string {
  const message = data.message as { content?: unknown } | undefined;
  return typeof message?.content === "string" ? message.content.trim() : "";
}

function shouldRegenerateResponse(params: {
  isHeuristic: boolean;
  hasLlm: boolean;
  content: string;
  generationError?: unknown;
}): { shouldRegenerate: boolean; reason?: string } {
  if (!params.isHeuristic || !params.hasLlm) {
    return { shouldRegenerate: false };
  }
  if (typeof params.generationError === "string" && params.generationError.trim()) {
    return { shouldRegenerate: true, reason: "generation_error" };
  }
  if (params.content.length < API_LLM_REGEN_MIN_CONTENT_CHARS) {
    return { shouldRegenerate: true, reason: "content_too_short" };
  }
  return { shouldRegenerate: false, reason: "workflow_content_accepted" };
}

function clamp01(value: unknown, fallback = 0.6): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function buildRoutingCacheKey(currentMessage: string, conversationHistory: ConversationMessage[]): string {
  const tail = conversationHistory
    .slice(-2)
    .map((m) => `${m.role}:${m.content}`)
    .join(" || ");
  return `${currentMessage.trim().toLowerCase()} ## ${tail.trim().toLowerCase()}`;
}

type LLMRouterOutcome =
  | { ok: true; decision: RoutingDecision }
  | { ok: false; fallback_reason: string };

async function inferRoutingWithLLM(
  currentMessage: string,
  conversationHistory: ConversationMessage[]
): Promise<LLMRouterOutcome> {
  if (!isLLMAvailable()) {
    return { ok: false, fallback_reason: "llm_unavailable" };
  }

  const historySnippet = conversationHistory
    .slice(-4)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");
  const systemPrompt = [
    "You are an intent router for a caregiver assistant.",
    "Return JSON only with keys:",
    "coaching_mode, mode_confidence, needs_retrieval, routing_reason.",
    'coaching_mode must be one of: "emotional_support", "practical_education", "policy_navigation", "mixed".',
    "Use mixed when the message contains BOTH emotional distress (fear, anxiety, overwhelm) AND a request for official policy/benefits/eligibility information.",
    "needs_retrieval should be true when the user asks for policy facts, benefits, eligibility, or official sources.",
    "When user explicitly says they do not need policy/citations, set needs_retrieval false and avoid policy_navigation.",
    "Keep routing_reason short and machine-friendly (snake_case).",
  ].join("\n");
  const userPrompt = [
    `Current user message:\n${currentMessage}`,
    historySnippet ? `\nRecent conversation:\n${historySnippet}` : "",
    "\nRespond in JSON only.",
  ].join("\n");

  let llmResult: Awaited<ReturnType<typeof generateLLMResponse>>;
  try {
    llmResult = await generateLLMResponse(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        temperature: 0,
        max_tokens: 220,
        timeoutMs: LLM_ROUTER_TIMEOUT_MS,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[router] LLM routing call threw:", msg);
    return { ok: false, fallback_reason: msg.includes("timeout") || msg.includes("abort") ? "llm_timeout" : "llm_error" };
  }
  if (!llmResult) {
    return { ok: false, fallback_reason: "llm_null_response" };
  }

  const parsed = parseJsonObjectFromText(llmResult.content);
  if (!parsed) {
    console.warn("[router] LLM returned unparseable content:", llmResult.content.slice(0, 200));
    return { ok: false, fallback_reason: "llm_invalid_json" };
  }
  if (!isCoachingMode(parsed.coaching_mode)) {
    console.warn("[router] LLM returned invalid coaching_mode:", parsed.coaching_mode);
    return { ok: false, fallback_reason: "llm_invalid_mode" };
  }

  return {
    ok: true,
    decision: {
      coaching_mode: parsed.coaching_mode,
      mode_confidence: clamp01(parsed.mode_confidence, 0.65),
      needs_retrieval: Boolean(parsed.needs_retrieval),
      routing_reason:
        typeof parsed.routing_reason === "string" && parsed.routing_reason.trim()
          ? parsed.routing_reason.trim()
          : "llm_router",
      source: "llm",
      llm_duration_ms: llmResult.duration_ms,
    },
  };
}

async function resolveRoutingDecision(params: {
  requestedMode?: CoachingMode;
  userMessage: string;
  isolatedHistory: ConversationMessage[];
  directScores: { policy: number; education: number; emotional: number };
}): Promise<RoutingDecision & { llm_fallback_reason?: string }> {
  const { requestedMode, userMessage, isolatedHistory, directScores } = params;
  if (requestedMode) {
    return {
      coaching_mode: requestedMode,
      mode_confidence: 1,
      needs_retrieval: shouldRetrieveEvidence(requestedMode, userMessage, isolatedHistory),
      routing_reason: "requested_mode",
      source: "requested",
    };
  }

  const cacheKey = buildRoutingCacheKey(userMessage, isolatedHistory);
  const cached = llmRoutingCache.get(cacheKey);
  if (cached && cached.expires_at > Date.now()) {
    return { ...cached.decision, source: "llm_cache" };
  }

  const llmOutcome = await inferRoutingWithLLM(userMessage, isolatedHistory);
  if (llmOutcome.ok) {
    const d = llmOutcome.decision;
    if (d.mode_confidence < LLM_ROUTER_MIN_CONFIDENCE) {
      console.warn(
        `[router] LLM confidence ${d.mode_confidence} below threshold ${LLM_ROUTER_MIN_CONFIDENCE}, falling back to heuristic`
      );
    } else {
      const withRetrieval = {
        ...d,
        needs_retrieval: shouldRetrieveEvidence(d.coaching_mode, userMessage, isolatedHistory),
      };
      llmRoutingCache.set(cacheKey, {
        expires_at: Date.now() + LLM_ROUTER_CACHE_TTL_MS,
        decision: withRetrieval,
      });
      return withRetrieval;
    }
  }

  const llmFallbackReason = llmOutcome.ok
    ? `llm_low_confidence_${llmOutcome.decision.mode_confidence}`
    : llmOutcome.fallback_reason;

  let fallbackMode = inferIntentWithHistory(userMessage, isolatedHistory);
  if (hasPolicyOptOut(userMessage) && directScores.education > 0) {
    fallbackMode = "practical_education";
  }
  return {
    coaching_mode: fallbackMode,
    mode_confidence: 0.55,
    needs_retrieval: shouldRetrieveEvidence(fallbackMode, userMessage, isolatedHistory),
    routing_reason: "heuristic_fallback",
    source: "heuristic",
    llm_fallback_reason: llmFallbackReason,
  };
}

export function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/chat",
    method: "POST",
    hint: "Send POST with body: { session_id, turn_index, message, context }.",
  });
}

function generateRequestId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function POST(request: NextRequest) {
  let request_id: string = generateRequestId();
  const startedAt = Date.now();
  try {
    const body = await request.json();
    request_id = body?.request_id ?? request.headers.get("x-request-id") ?? generateRequestId();

    const sessionUser = await getSessionUser();
    const userId = sessionUser?.id ?? null;

    const bodyWithRequestId = { ...body, request_id, user_id: userId };
    const userMessage = String(body?.message ?? "");
    const sessionId = typeof body?.session_id === "string" ? body.session_id : "";
    const routingHints = (body?.routing_hints ?? {}) as RoutingHints;
    const requestedRouteKey =
      typeof routingHints.route_key === "string" && routingHints.route_key.trim()
        ? routingHints.route_key.trim()
        : undefined;
    const requestedMode = isCoachingMode(routingHints.target_mode) ? routingHints.target_mode : undefined;
    const directScores = getKeywordScores(userMessage);

    // Conversation history from the frontend (last N messages)
    const conversationHistory: ConversationMessage[] = Array.isArray(body?.messages)
      ? (body.messages as ConversationMessage[]).filter(
          (m) => typeof m.role === "string" && typeof m.content === "string"
        )
      : [];
    const { history: isolatedHistory, historyFiltered } = isolateConversationHistory(
      conversationHistory,
      requestedRouteKey
    );

    const routingDecision = await resolveRoutingDecision({
      requestedMode,
      userMessage,
      isolatedHistory,
      directScores,
    });
    const fallbackMode = routingDecision.coaching_mode;
    const resolvedRouteKey =
      requestedRouteKey || (sessionId ? buildRouteKey(sessionId, fallbackMode) : undefined);

    // Retrieval is required for policy and mixed turns. For practical education,
    // only retrieve when the prompt still carries policy-like grounding needs.
    let retrieval: RetrievalResult | null = null;
    const needsRetrieval = routingDecision.needs_retrieval;
    if (needsRetrieval && userMessage.trim().length > 0) {
      try {
        const retrievalQuery = getRetrievalQuery(userMessage, isolatedHistory);
        retrieval = await retrievePolicyEvidence(retrievalQuery);
      } catch (err) {
        console.error("[chat] Retrieval error (continuing without evidence):", err);
      }
    }

    const n8nPayload = {
      ...bodyWithRequestId,
      routing_hints: {
        ...(routingHints ?? {}),
        route_key: resolvedRouteKey,
        target_mode: fallbackMode,
        isolation_scope: routingHints.isolation_scope ?? "mode_lane",
        mode_confidence: routingDecision.mode_confidence,
        routing_source: routingDecision.source,
        routing_reason: routingDecision.routing_reason,
      },
      session_routing: resolvedRouteKey
        ? {
            route_key: resolvedRouteKey,
            isolation_scope: routingHints.isolation_scope ?? "mode_lane",
            resolved_mode: fallbackMode,
            history_turns_used: isolatedHistory.length,
            history_filtered: historyFiltered,
            workflow: body?.workflow === "simple" ? "simple" : "full",
          }
        : undefined,
      ...(retrieval && retrieval.evidence.length > 0
        ? {
            prefetched_evidence: retrieval.evidence,
            retrieval_meta: {
              method: retrieval.method,
              query_embedding_ms: retrieval.query_embedding_ms,
              search_ms: retrieval.search_ms,
              total_ms: retrieval.total_ms,
              count: retrieval.evidence.length,
            },
          }
        : {}),
    };

    const workflowPath =
      body?.workflow === "simple"
        ? "big5loop-turn-simple"
        : body?.workflow === "benchmark"
        ? "big5loop-turn-personage-benchmark"
        : "big5loop-turn";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
    const res = await fetch(`${WEBHOOK_URL}/webhook/${workflowPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(n8nPayload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const raw = await res.json().catch(() => ({}));
    const data = Array.isArray(raw) ? raw[0] : raw;

    if (!res.ok) {
      const n8nHint =
        "N8N webhook not found. Import and activate big5loop-phase1-2-postgres-mvp-v2.json (or big5loop-simplified.json) in N8N. Local: http://localhost:5678. Production: use SSH tunnel (see docs/DEPLOY-TO-SERVER.md).";
      const message =
        res.status === 404
          ? n8nHint
          : (data?.error?.message ?? data?.error ?? data?.message ?? `Upstream ${res.status}`);
      return errorResponse(
        "internal_error",
        message,
        res.status,
        { stage: "generation", retryable: res.status >= 500, session_id: body?.session_id, request_id }
      );
    }

    // N8N returned 200 but body is error envelope
    if (data && typeof data === "object" && data.success === false && data.error && typeof data.error === "object") {
      const err = data.error as { error_code?: string; message?: string; stage?: string };
      const code = isErrorCode(err.error_code) ? err.error_code : "internal_error";
      const message = typeof err.message === "string" ? err.message : "Workflow returned an error.";
      return errorResponse(code, message, 503, {
        stage: "generation",
        retryable: true,
        session_id: body?.session_id,
        request_id: (data as { request_id?: string }).request_id ?? request_id,
        fallback_content: (data as { fallback_content?: string }).fallback_content,
      });
    }

    // Malformed or empty response
    if (!data || typeof data !== "object") {
      return errorResponse(
        "internal_error",
        "Invalid response from workflow (no data).",
        503,
        { stage: "generation", retryable: true, session_id: body?.session_id, request_id }
      );
    }
    const hasMessage = data.message && typeof data.message === "object" && typeof (data.message as { content?: unknown }).content === "string";
    if (!data.session_id || !hasMessage) {
      return errorResponse(
        "verifier_fallback",
        "Workflow response missing required fields (session_id or message.content).",
        503,
        { stage: "verification", retryable: true, session_id: body?.session_id, request_id }
      );
    }

    if (!data.coaching_mode) {
      data.coaching_mode = fallbackMode;
    }

    // Override N8N's mode when our API-side inference is more trustworthy.
    // N8N has no conversation history, and pure practical prompts can be under-routed
    // when policy retrieval is intentionally skipped for latency reasons.
    const shouldTrustFallbackMode =
      requestedMode !== undefined ||
      (
        retrieval &&
        retrieval.evidence.length > 0 &&
        (fallbackMode === "policy_navigation" || fallbackMode === "mixed" || fallbackMode === "practical_education")
      ) ||
      (
        fallbackMode === "practical_education" &&
        directScores.education > 0 &&
        (directScores.policy === 0 || hasPolicyOptOut(userMessage))
      );
    if (shouldTrustFallbackMode && data.coaching_mode !== fallbackMode) {
      data.coaching_mode = fallbackMode;
    }

    if (typeof data.mode_confidence !== "number") {
      data.mode_confidence = routingDecision.mode_confidence;
    }
    if (typeof data.mode_routing_reason !== "string" || !data.mode_routing_reason) {
      data.mode_routing_reason = routingDecision.routing_reason;
    }
    data.session_routing = {
      route_key:
        resolvedRouteKey ||
        (typeof data.session_id === "string" && isCoachingMode(data.coaching_mode)
          ? buildRouteKey(data.session_id, data.coaching_mode)
          : undefined),
      isolation_scope: routingHints.isolation_scope ?? "mode_lane",
      resolved_mode: String(data.coaching_mode ?? fallbackMode),
      history_turns_used: isolatedHistory.length,
      history_filtered: historyFiltered,
      workflow: body?.workflow === "simple" ? "simple" : "full",
    };

    // ── Pipeline invariants ──
    // 1. OCEAN detection + regulation: always run (N8N full pipeline guarantees this)
    // 2. Retrieval: conditional (only for policy/mixed or when policy keywords present)
    // 3. Grounding verification: mandatory when factual/policy content is present
    const pipelineStatus = data.pipeline_status as Record<string, unknown> | undefined;
    const debugInfo = data.debug as Record<string, unknown> | undefined;
    const regulation = data.regulation as { directives?: string[] } | undefined;
    const personalityState = data.personality_state as Record<string, unknown> | undefined;

    // Invariant 1: flag if OCEAN detection was skipped (should never happen in full pipeline)
    if (!personalityState && debugInfo) {
      debugInfo.ocean_detection_skipped = true;
      console.warn("[chat] OCEAN detection was not run — personality_state missing from workflow response");
    }
    if (!regulation?.directives?.length && debugInfo) {
      debugInfo.regulation_skipped = true;
    }
    if (debugInfo) {
      debugInfo.routing_source = routingDecision.source;
      debugInfo.routing_reason = routingDecision.routing_reason;
      debugInfo.routing_mode_confidence = routingDecision.mode_confidence;
      if (typeof routingDecision.llm_duration_ms === "number") {
        debugInfo.routing_llm_ms = routingDecision.llm_duration_ms;
      }
      if (routingDecision.llm_fallback_reason) {
        debugInfo.routing_llm_fallback = routingDecision.llm_fallback_reason;
      }
    }
    const isHeuristic =
      pipelineStatus?.generator === "heuristic" ||
      pipelineStatus?.generator === "fallback" ||
      typeof debugInfo?.generation_error === "string";
    const currentAssistantContent = getAssistantContent(data as Record<string, unknown>);
    const regenerationDecision = shouldRegenerateResponse({
      isHeuristic,
      hasLlm: isLLMAvailable(),
      content: currentAssistantContent,
      generationError: debugInfo?.generation_error,
    });

    if (debugInfo && regenerationDecision.reason) {
      debugInfo.regeneration_decision = regenerationDecision.reason;
    }

    if (regenerationDecision.shouldRegenerate) {
      const coachingMode = String(data.coaching_mode || "emotional_support");
      const evidence = retrieval?.evidence?.map((e) => ({
        source_id: e.source_id,
        title: e.title,
        content: e.content,
        url: e.url ?? undefined,
      }));

      const systemPrompt = buildSystemPrompt(
        coachingMode,
        evidence,
        Array.isArray(regulation?.directives) ? regulation.directives : undefined
      );

      const llmMessages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
      ];

      // Include conversation history for multi-turn context
      const historySlice = isolatedHistory.slice(-8);
      for (const m of historySlice) {
        if (m.role === "user" || m.role === "assistant") {
          llmMessages.push({
            role: m.role as "user" | "assistant",
            content: m.content,
          });
        }
      }

      // Current user message (may already be in historySlice, avoid duplication)
      const lastInHistory = historySlice[historySlice.length - 1];
      if (!lastInHistory || lastInHistory.role !== "user" || lastInHistory.content !== userMessage) {
        llmMessages.push({ role: "user", content: userMessage });
      }

      try {
        const llmResult = await generateLLMResponse(llmMessages, {
          timeoutMs: API_LLM_REGEN_TIMEOUT_MS,
        });
        if (llmResult) {
          const msg = data.message as { content?: string };
          msg.content = llmResult.content;
          data.reply = llmResult.content;

          // Update pipeline status to reflect LLM regeneration
          if (pipelineStatus) {
            pipelineStatus.generator = "nvidia";
            pipelineStatus.generation_source = "api-route";
          }
          if (debugInfo) {
            debugInfo.generation_error = null;
            debugInfo.regeneration_ms = llmResult.duration_ms;
            debugInfo.regeneration_model = llmResult.model;
          }

          console.log(
            `[chat] LLM regeneration replaced heuristic (${llmResult.duration_ms}ms, ${llmResult.model})`
          );
        }
      } catch (err) {
        console.error("[chat] LLM regeneration failed, keeping N8N response:", err);
      }
    }

    // Overlay vector retrieval citations onto response
    if (retrieval && retrieval.evidence.length > 0) {
      const mode = data.coaching_mode as string;
      if (mode === "policy_navigation" || mode === "mixed" || (mode === "practical_education" && needsRetrieval)) {
        const pn = (data.policy_navigation ?? {}) as Record<string, unknown>;
        pn.citations = retrieval.evidence.map((e) => ({
          source_id: e.source_id,
          title: e.title,
          url: e.url,
          similarity: e.similarity,
          retrieval_method: e.retrieval_method,
        }));
        data.policy_navigation = pn;

        const ps = (data.pipeline_status ?? {}) as Record<string, unknown>;
        ps.retrieval = "ok";
        ps.retrieval_method = retrieval.method;
        data.pipeline_status = ps;

        (data as Record<string, unknown>).retrieval_timing = {
          method: retrieval.method,
          query_embedding_ms: retrieval.query_embedding_ms,
          search_ms: retrieval.search_ms,
          total_ms: retrieval.total_ms,
          evidence_count: retrieval.evidence.length,
        };
      }
    }

    // Invariant 3: grounding verification — policy/mixed must have citations
    const resolvedMode = data.coaching_mode as string;
    const policyNav = data.policy_navigation as { citations?: unknown[] } | undefined;
    const citationCount = Array.isArray(policyNav?.citations) ? policyNav.citations.length : 0;
    if ((resolvedMode === "policy_navigation" || resolvedMode === "mixed") && citationCount === 0) {
      if (pipelineStatus) {
        pipelineStatus.grounding_check = "warn_no_citations";
      }
      if (debugInfo) {
        debugInfo.grounding_warning = "factual_mode_without_citations";
      }
      console.warn(
        `[chat] Grounding warning: ${resolvedMode} response has 0 citations — retrieval may have failed or been skipped`
      );
    } else if ((resolvedMode === "policy_navigation" || resolvedMode === "mixed") && citationCount > 0) {
      if (pipelineStatus) {
        pipelineStatus.grounding_check = "pass";
      }
    }

    if (data.coaching_mode === "practical_education" && !needsRetrieval) {
      const pn = (data.policy_navigation ?? {}) as Record<string, unknown>;
      pn.citations = [];
      pn.active = false;
      data.policy_navigation = pn;

      const ps = (data.pipeline_status ?? {}) as Record<string, unknown>;
      ps.retrieval = "skipped";
      delete ps.retrieval_method;
      data.pipeline_status = ps;

      delete (data as Record<string, unknown>).retrieval_timing;
    }

    if (request_id && !data.request_id) {
      data.request_id = request_id;
    }

    // Audit
    const latencyMs = Date.now() - startedAt;
    const auditPayload = buildAuditPayload(
      data as Record<string, unknown>,
      body as {
        session_id?: string;
        turn_index?: number;
        message?: string;
        routing_hints?: {
          route_key?: string;
          isolation_scope?: string;
          workflow?: string;
        };
      },
      {
        messageForHash: typeof body?.message === "string" ? body.message : undefined,
        latencyMs,
      }
    );
    auditTurn(auditPayload);
    writeAuditToDb(auditPayload);
    if (Array.isArray((data as { stage_timings?: unknown }).stage_timings)) {
      const sid = body?.session_id;
      const tid = body?.turn_index;
      if (typeof sid === "string" && typeof tid === "number") {
        writeStageTimingsToDb(sid, tid, (data as { stage_timings: unknown }).stage_timings);
      }
    }
    return NextResponse.json(data);
  } catch (e) {
    const isTimeout = e instanceof Error && e.name === "AbortError";
    const message = isTimeout
      ? "Request to N8N timed out. Check that N8N is running and the workflow is active."
      : e instanceof Error
        ? e.message
        : "Request failed";
    return errorResponse(
      isTimeout ? "timeout_fallback" : "internal_error",
      message,
      500,
      { stage: "generation", retryable: isTimeout, request_id }
    );
  }
}
