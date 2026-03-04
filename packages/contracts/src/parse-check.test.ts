import { parseInboundRequest, parseFinalResponseOutput, safeParseInboundRequest } from "./index.js";

const validRequest = {
  session_id: "550e8400-e29b-41d4-a716-446655440000",
  turn_index: 1,
  message: "Hello",
  context: { language: "en" as const, canton: "ZH" },
};
const validResponse = {
  session_id: "550e8400-e29b-41d4-a716-446655440000",
  message: {
    role: "assistant" as const,
    content: "Hi there.",
    timestamp: "2026-03-03T12:00:00.000Z",
  },
  personality_state: {
    ocean: { O: 0.1, C: 0.2, E: -0.1, A: 0.3, N: 0.2 },
    confidence: { O: 0.8, C: 0.7, E: 0.6, A: 0.85, N: 0.88 },
    stable: false,
    ema_applied: true,
  },
  policy_navigation: { active: false, citations: [] },
  pipeline_status: {
    detector: "ok",
    regulator: "ok",
    generator: "ok",
    verifier: "ok",
  },
};

parseInboundRequest(validRequest);
parseFinalResponseOutput(validResponse);

const badRequest = { session_id: "not-a-uuid", turn_index: -1 };
const result = safeParseInboundRequest(badRequest);
if (result.success) throw new Error("Expected validation to fail");
console.log("Contract parse checks passed.");
