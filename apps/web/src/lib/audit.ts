/**
 * Phase 3 audit: JSONL per turn (Spec §11).
 * One line per completed turn for observability and compliance.
 * Set AUDIT_LOG_PATH to enable; no-op if unset.
 * For DB persistence when compliance requires, see docs/AUDIT-LOG-PERSISTENCE.md and audit_log table in infra/database/init.sql.
 */

import { appendFile } from "fs/promises";
import { createHash } from "crypto";

const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH ?? "";

export type AuditTurnPayload = {
  request_id: string;
  session_id: string;
  turn_index: number;
  coaching_mode: string;
  pipeline_status: Record<string, string>;
  routing?: {
    route_key?: string;
    isolation_scope?: string;
    resolved_mode?: string;
    history_turns_used?: number;
    history_filtered?: boolean;
    workflow?: string;
  };
  /** Traits summary (no PII); ocean keys only */
  personality?: { ocean?: Record<string, number>; stable?: boolean };
  /** Citation/source ids for policy turns */
  retrieval_ids?: string[];
  citation_count?: number;
  verifier_status?: string;
  timestamp: string;
  /** Optional: hash of user message for dedup/debug (no PII). */
  input_hash?: string;
  /** Optional: API-side turn latency in ms (SLO). */
  turn_latency_ms?: number;
};

/** One-way hash of input for audit; no PII stored. */
export function hashForAudit(text: string): string {
  if (!text || typeof text !== "string") return "";
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

/**
 * Append one JSONL line for this turn. Fire-and-forget; does not block response.
 * Safe to call when AUDIT_LOG_PATH is unset (no-op).
 */
export function auditTurn(payload: AuditTurnPayload): void {
  if (!AUDIT_LOG_PATH) return;
  const line = JSON.stringify(payload) + "\n";
  appendFile(AUDIT_LOG_PATH, line).catch(() => {
    // Avoid leaking errors to client; log to stderr only if needed
    // console.error("[audit] append failed:", err);
  });
}

export type BuildAuditOptions = {
  /** If set, include input_hash (hash of message, no PII). */
  messageForHash?: string;
  /** If set, include turn_latency_ms (API-side latency in ms). */
  latencyMs?: number;
};

/**
 * Build audit payload from workflow response and request body.
 */
export function buildAuditPayload(
  data: Record<string, unknown>,
  body: {
    session_id?: string;
    turn_index?: number;
    message?: string;
    routing_hints?: {
      route_key?: string;
      isolation_scope?: string;
      workflow?: string;
    };
  },
  options?: BuildAuditOptions
): AuditTurnPayload {
  const pipeline_status = (data.pipeline_status as Record<string, string>) ?? {};
  const personality_state = data.personality_state as Record<string, unknown> | undefined;
  const policy_nav = data.policy_navigation as { citations?: Array<{ source_id?: string }> } | undefined;
  const session_routing = data.session_routing as Record<string, unknown> | undefined;
  const citations = policy_nav?.citations ?? [];
  const retrieval_ids = citations.map((c) => String(c?.source_id ?? "")).filter(Boolean);

  const payload: AuditTurnPayload = {
    request_id: String(data.request_id ?? ""),
    session_id: String(data.session_id ?? body?.session_id ?? ""),
    turn_index: Number(body?.turn_index ?? (data.debug as Record<string, unknown>)?.turn_index ?? 1),
    coaching_mode: String(data.coaching_mode ?? "emotional_support"),
    pipeline_status: {
      detector: pipeline_status.detector ?? "unknown",
      generator: pipeline_status.generator ?? "unknown",
      verifier: pipeline_status.verifier ?? "unknown",
      retrieval: pipeline_status.retrieval ?? "skipped",
      fact_invariance_check: pipeline_status.fact_invariance_check ?? "skipped",
    },
    routing:
      session_routing || body?.routing_hints
        ? {
            route_key:
              typeof session_routing?.route_key === "string"
                ? session_routing.route_key
                : body?.routing_hints?.route_key,
            isolation_scope:
              typeof session_routing?.isolation_scope === "string"
                ? session_routing.isolation_scope
                : body?.routing_hints?.isolation_scope,
            resolved_mode:
              typeof session_routing?.resolved_mode === "string"
                ? session_routing.resolved_mode
                : String(data.coaching_mode ?? "emotional_support"),
            history_turns_used:
              typeof session_routing?.history_turns_used === "number"
                ? session_routing.history_turns_used
                : undefined,
            history_filtered:
              typeof session_routing?.history_filtered === "boolean"
                ? session_routing.history_filtered
                : undefined,
            workflow:
              typeof session_routing?.workflow === "string"
                ? session_routing.workflow
                : body?.routing_hints?.workflow,
          }
        : undefined,
    personality: personality_state
      ? {
          ocean: personality_state.ocean as Record<string, number> | undefined,
          stable: Boolean(personality_state.stable),
        }
      : undefined,
    retrieval_ids: retrieval_ids.length > 0 ? retrieval_ids : undefined,
    citation_count: citations.length,
    verifier_status: pipeline_status.verifier ?? "unknown",
    timestamp: new Date().toISOString(),
  };
  if (options?.messageForHash) payload.input_hash = hashForAudit(options.messageForHash);
  if (options?.latencyMs != null) payload.turn_latency_ms = options.latencyMs;
  return payload;
}
