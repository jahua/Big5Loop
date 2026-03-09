-- Migration: BIG5-CHAT evaluation user and metadata
-- Run on existing CareLoop databases. Enables evaluation sessions to be saved and reviewed.

-- 1. Simulation evaluation user (NOT a real person — for BIG5-CHAT eval only)
-- Login: big5_eval@careloop.ch / careloop123
-- Classification: sessions with this user_id = simulation evaluation
INSERT INTO users (email, password_hash, display_name, locale, canton)
VALUES (
  'big5_eval@careloop.ch',
  '$2a$10$BrS0H/n/.MEfEIUfQS7.0u33SSK2Ja197qOrKg9Kng5r77qPk3zdu',
  'BIG5-CHAT Simulation (not real person)',
  'en',
  'ZH'
)
ON CONFLICT (email) DO NOTHING;

-- 2. Eval session metadata (ground truth for review)
CREATE TABLE IF NOT EXISTS eval_session_metadata (
  session_id   UUID PRIMARY KEY REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  eval_run_id  TEXT NOT NULL,
  ground_truth JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_metadata_run ON eval_session_metadata(eval_run_id);

COMMENT ON TABLE eval_session_metadata IS 'Ground truth (trait, level) for BIG5-CHAT evaluation sessions; used for review and scoring';
