/**
 * Coaching mode (pillar) per Spec §8.4.
 */

export const COACHING_MODES = [
  "emotional_support",
  "practical_education",
  "policy_navigation",
  "mixed",
] as const;

export type CoachingMode = (typeof COACHING_MODES)[number];

export function isCoachingMode(s: string): s is CoachingMode {
  return COACHING_MODES.includes(s as CoachingMode);
}

export const DEFAULT_COACHING_MODE: CoachingMode = "emotional_support";
