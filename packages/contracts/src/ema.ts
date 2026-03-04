/**
 * EMA state update and stability per Spec §4.1.
 * Default alpha=0.3, confidence threshold 0.4, stable after 6+ consistent turns.
 */

export const DEFAULT_ALPHA = 0.3;
export const CONFIDENCE_THRESHOLD = 0.4;
export const STABILITY_TURNS = 6;
export const STABILITY_VARIANCE_THRESHOLD = 0.05;

const OCEAN_KEYS = ["O", "C", "E", "A", "N"] as const;
type OceanKey = (typeof OCEAN_KEYS)[number];

export type OceanScores = Record<OceanKey, number>;
export type ConfidenceScores = Record<OceanKey, number>;

export interface PersonalityStateSnapshot {
  ocean: OceanScores;
  confidence: ConfidenceScores;
  stable: boolean;
  ema_applied: boolean;
  turn_index?: number;
}

export interface DetectionOutput {
  ocean: OceanScores;
  confidence: ConfidenceScores;
  reasoning: string;
}

/**
 * Apply EMA per trait: new = alpha * detected + (1 - alpha) * previous.
 * If confidence for a trait < CONFIDENCE_THRESHOLD, keep previous value.
 */
export function applyEMA(
  previous: OceanScores | null,
  detection: DetectionOutput,
  alpha: number = DEFAULT_ALPHA
): { ocean: OceanScores; confidence: ConfidenceScores; ema_applied: boolean } {
  const ocean: OceanScores = { O: 0, C: 0, E: 0, A: 0, N: 0 };
  const confidence = { ...detection.confidence };
  let ema_applied = false;

  for (const k of OCEAN_KEYS) {
    const conf = detection.confidence[k];
    const detected = detection.ocean[k];
    if (previous === null || conf < CONFIDENCE_THRESHOLD) {
      ocean[k] = previous === null ? detected : previous[k];
      if (previous !== null && conf < CONFIDENCE_THRESHOLD) {
        // keep previous; don't count as EMA applied for this trait
      } else if (previous === null) {
        ema_applied = true;
      }
    } else {
      ocean[k] = alpha * detected + (1 - alpha) * previous[k];
      ema_applied = true;
    }
  }
  return { ocean, confidence, ema_applied };
}

/**
 * Variance of OCEAN values over recent turns (e.g. last N entries).
 * Used to decide if profile is "stable".
 */
export function oceanVariance(history: OceanScores[]): number {
  if (history.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (const k of OCEAN_KEYS) {
    const values = history.map((h) => h[k]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    sum += variance;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Mark stable when we have at least STABILITY_TURNS and variance is low.
 */
export function isStable(
  oceanHistory: OceanScores[],
  varianceThreshold: number = STABILITY_VARIANCE_THRESHOLD
): boolean {
  if (oceanHistory.length < STABILITY_TURNS) return false;
  const recent = oceanHistory.slice(-STABILITY_TURNS);
  return oceanVariance(recent) <= varianceThreshold;
}
