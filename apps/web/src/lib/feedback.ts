/**
 * Phase 3 P1-5: Optional post-turn feedback for quality monitoring (Spec §11).
 * One JSONL line per feedback event when FEEDBACK_LOG_PATH is set.
 */

import { appendFile } from "fs/promises";

const FEEDBACK_LOG_PATH = process.env.FEEDBACK_LOG_PATH ?? "";

export type FeedbackPayload = {
  session_id: string;
  turn_index?: number;
  request_id?: string;
  thumbs_up_down?: "up" | "down";
  helpfulness_score?: number;
  ratings?: { relevance: number; tone: number; personality_fit: number };
  comment?: string;
  timestamp: string;
};

/**
 * Append one JSONL line for this feedback. Fire-and-forget; does not block.
 * No-op when FEEDBACK_LOG_PATH is unset.
 */
export function feedbackLog(payload: FeedbackPayload): void {
  if (!FEEDBACK_LOG_PATH) return;
  const line = JSON.stringify(payload) + "\n";
  appendFile(FEEDBACK_LOG_PATH, line).catch(() => {});
}
