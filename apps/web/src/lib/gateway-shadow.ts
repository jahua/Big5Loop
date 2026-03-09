/**
 * P2 Gateway shadow: log gateway request envelope for validation (observe-only).
 * When GATEWAY_SHADOW_LOG is set, appends one JSONL line per request. Fire-and-forget.
 * See docs/GATEWAY-SHADOW-DESIGN.md.
 */

import { appendFile } from "fs/promises";

const GATEWAY_SHADOW_LOG = process.env.GATEWAY_SHADOW_LOG ?? "";

export type GatewayEnvelope = {
  request_id?: string;
  session_id: string;
  user_id?: string;
  message: string;
  context?: { canton?: string; language?: string };
  routing_hints?: {
    force_policy_mode?: boolean;
    model_tier?: "light" | "medium" | "heavy";
    workflow?: "simple";
    target_mode?: "emotional_support" | "practical_education" | "policy_navigation" | "mixed";
    route_key?: string;
    isolation_scope?: "mode_lane" | "session";
  };
};

export type GatewayShadowResult = {
  request_id: string;
  session_id: string;
  status_code: number;
  latency_ms: number;
  has_error_envelope?: boolean;
  error_code?: string;
};

export function logGatewayShadow(envelope: GatewayEnvelope): void {
  if (!GATEWAY_SHADOW_LOG) return;
  const line =
    JSON.stringify({
      ...envelope,
      _event: "gateway_request",
      _logged_at: new Date().toISOString(),
      _source: "gateway-shadow",
    }) + "\n";
  appendFile(GATEWAY_SHADOW_LOG, line).catch(() => {});
}

export function logGatewayShadowResult(result: GatewayShadowResult): void {
  if (!GATEWAY_SHADOW_LOG) return;
  const line =
    JSON.stringify({
      ...result,
      _event: "gateway_response",
      _logged_at: new Date().toISOString(),
      _source: "gateway-shadow",
    }) + "\n";
  appendFile(GATEWAY_SHADOW_LOG, line).catch(() => {});
}
