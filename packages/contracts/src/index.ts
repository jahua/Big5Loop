import { z } from "zod";

const OCEAN_KEYS = ["O", "C", "E", "A", "N"] as const;
const oceanSchema = z.object({
  O: z.number().min(-1).max(1),
  C: z.number().min(-1).max(1),
  E: z.number().min(-1).max(1),
  A: z.number().min(-1).max(1),
  N: z.number().min(-1).max(1),
});
const confidenceSchema = z.object({
  O: z.number().min(0).max(1),
  C: z.number().min(0).max(1),
  E: z.number().min(0).max(1),
  A: z.number().min(0).max(1),
  N: z.number().min(0).max(1),
});

/** §6.1 Inbound request */
export const InboundRequestSchema = z.object({
  session_id: z.string().uuid(),
  turn_index: z.number().int().nonnegative(),
  message: z.string(),
  context: z.object({
    language: z.enum(["de", "fr", "it", "en"]),
    language_auto_detected: z.string().optional(),
    canton: z.string().length(2).optional(),
  }),
});
export type InboundRequest = z.infer<typeof InboundRequestSchema>;

/** §6.2 Detection output */
export const DetectionOutputSchema = z.object({
  ocean: oceanSchema,
  confidence: confidenceSchema,
  reasoning: z.string(),
});
export type DetectionOutput = z.infer<typeof DetectionOutputSchema>;

/** §6.3 RAG retrieval output */
export const EvidenceItemSchema = z.object({
  source_id: z.string(),
  title: z.string(),
  url: z.string().url(),
  chunk_id: z.string(),
  excerpt: z.string(),
});
export const RagRetrievalOutputSchema = z.object({
  mode: z.literal("policy_navigation"),
  query_rewrite: z.string(),
  top_k: z.number().int().positive(),
  evidence: z.array(EvidenceItemSchema),
});
export type RagRetrievalOutput = z.infer<typeof RagRetrievalOutputSchema>;

/** §6.4 Final response output */
export const CitationSchema = z.object({
  source_id: z.string(),
  title: z.string(),
  url: z.string().url(),
});
export const PersonalityStateSchema = z.object({
  ocean: oceanSchema,
  confidence: confidenceSchema,
  stable: z.boolean(),
  ema_applied: z.boolean(),
});
export const PipelineStatusSchema = z.object({
  detector: z.enum(["ok", "degraded", "failed"]),
  regulator: z.enum(["ok", "degraded", "failed"]),
  generator: z.enum(["ok", "degraded", "failed"]),
  verifier: z.enum(["ok", "degraded", "failed"]),
  retrieval: z.enum(["ok", "degraded", "failed", "skipped"]).optional(),
  fact_invariance_check: z.enum(["pass", "fail", "skipped"]).optional(),
});
export const FinalResponseOutputSchema = z.object({
  session_id: z.string().uuid(),
  message: z.object({
    role: z.literal("assistant"),
    content: z.string(),
    timestamp: z.string().datetime(),
  }),
  personality_state: PersonalityStateSchema,
  policy_navigation: z.object({
    active: z.boolean(),
    citations: z.array(CitationSchema),
  }),
  pipeline_status: PipelineStatusSchema,
});
export type FinalResponseOutput = z.infer<typeof FinalResponseOutputSchema>;

/** Validate and parse; throws on failure */
export function parseInboundRequest(data: unknown): InboundRequest {
  return InboundRequestSchema.parse(data);
}
export function parseDetectionOutput(data: unknown): DetectionOutput {
  return DetectionOutputSchema.parse(data);
}
export function parseRagRetrievalOutput(data: unknown): RagRetrievalOutput {
  return RagRetrievalOutputSchema.parse(data);
}
export function parseFinalResponseOutput(data: unknown): FinalResponseOutput {
  return FinalResponseOutputSchema.parse(data);
}

/** Safe parse; returns { success, data } or { success: false, error } */
export const safeParseInboundRequest = InboundRequestSchema.safeParse.bind(InboundRequestSchema);
export const safeParseFinalResponseOutput = FinalResponseOutputSchema.safeParse.bind(FinalResponseOutputSchema);

export type { OceanScores, ConfidenceScores, PersonalityStateSnapshot, DetectionOutput } from "./ema.js";
export {
  applyEMA,
  isStable,
  oceanVariance,
  DEFAULT_ALPHA,
  CONFIDENCE_THRESHOLD,
  STABILITY_TURNS,
  STABILITY_VARIANCE_THRESHOLD,
} from "./ema.js";
export type { CoachingMode } from "./coaching-mode.js";
export {
  COACHING_MODES,
  isCoachingMode,
  DEFAULT_COACHING_MODE,
} from "./coaching-mode.js";
