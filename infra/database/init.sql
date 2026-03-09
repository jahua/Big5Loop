-- CareLoop Phase 0 schema per Technical Specification §9
-- Run once on fresh PostgreSQL (e.g. docker exec or init volume)

-- ── Users (simple email/password auth) ──
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  display_name   TEXT,
  locale         TEXT DEFAULT 'de',
  canton         CHAR(2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  session_id   UUID PRIMARY KEY,
  user_id      UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'active',
  locale       TEXT,
  canton       CHAR(2)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions(user_id);

-- ── Stable cross-session personality profile per user ──
CREATE TABLE IF NOT EXISTS user_personality_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id),
  ocean_scores   JSONB NOT NULL DEFAULT '{"O":0,"C":0,"E":0,"A":0,"N":0}',
  confidence     JSONB NOT NULL DEFAULT '{"O":0,"C":0,"E":0,"A":0,"N":0}',
  total_turns    INT NOT NULL DEFAULT 0,
  stable         BOOLEAN NOT NULL DEFAULT false,
  last_updated   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  session_id    UUID NOT NULL REFERENCES chat_sessions(session_id),
  turn_index    INT NOT NULL,
  user_msg      TEXT NOT NULL,
  assistant_msg TEXT,
  mode          TEXT,
  latency_ms    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, turn_index)
);

CREATE TABLE IF NOT EXISTS personality_states (
  session_id     UUID NOT NULL,
  turn_index     INT NOT NULL,
  ocean_json     JSONB NOT NULL,
  confidence_json JSONB NOT NULL,
  stable         BOOLEAN NOT NULL DEFAULT false,
  ema_alpha      NUMERIC(5,4),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, turn_index),
  FOREIGN KEY (session_id, turn_index) REFERENCES conversation_turns(session_id, turn_index)
);

CREATE TABLE IF NOT EXISTS policy_evidence (
  session_id   UUID NOT NULL,
  turn_index   INT NOT NULL,
  source_id    TEXT NOT NULL,
  chunk_id     TEXT NOT NULL,
  title        TEXT,
  url          TEXT,
  excerpt_hash TEXT,
  PRIMARY KEY (session_id, turn_index, source_id, chunk_id),
  FOREIGN KEY (session_id, turn_index) REFERENCES conversation_turns(session_id, turn_index)
);

CREATE TABLE IF NOT EXISTS performance_metrics (
  session_id   UUID NOT NULL,
  turn_index   INT NOT NULL,
  stage        TEXT NOT NULL,
  status       TEXT NOT NULL,
  duration_ms  INT,
  error_code   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, turn_index) REFERENCES conversation_turns(session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_turns_session_turn ON conversation_turns(session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_personality_session_turn ON personality_states(session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_policy_evidence_source ON policy_evidence(source_id, chunk_id);


-- Hybrid external memory support (Gemma 3 + pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS personality_memory_embeddings (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL,
  turn_index INT NOT NULL,
  memory_text TEXT NOT NULL,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_session_turn ON personality_memory_embeddings(session_id, turn_index);

-- RAG Policy Chunks (Phase 1-2 Addition for P1-7)
CREATE TABLE IF NOT EXISTS policy_chunks (
  id SERIAL PRIMARY KEY,
  source_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT,
  embedding VECTOR(1024), -- Compatible with local BERT/Gemma embeddings or adaptable
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_policy_chunks_content_trgm ON policy_chunks USING gin (to_tsvector('english', content));

-- Phase 3: optional audit log table (when compliance requires DB persistence)
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL,
  session_id UUID NOT NULL,
  turn_index INT NOT NULL,
  coaching_mode TEXT,
  pipeline_status JSONB DEFAULT '{}'::jsonb,
  routing JSONB DEFAULT '{}'::jsonb,
  personality JSONB,
  retrieval_ids TEXT[],
  citation_count INT,
  verifier_status TEXT,
  input_hash TEXT,
  turn_latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS routing JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_audit_log_session_turn ON audit_log(session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_audit_log_request ON audit_log(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- Seed Data for IV (Domain Pack A)
INSERT INTO policy_chunks (source_id, chunk_id, title, content, url, metadata)
VALUES 
(
  'iv_guideline_2025', 
  'iv_eligibility_basic', 
  'IV Eligibility - Basic Conditions', 
  'To be eligible for Invalidenversicherung (IV) benefits in Switzerland, you must meet three basic conditions: 1) You must be insured in Switzerland (residence or employment). 2) You must have a health impairment that restricts your ability to work or perform daily tasks. 3) The incapacity to work must be likely to last at least one year.', 
  'https://www.ahv-iv.ch/en/Social-insurances/Invalidity-insurance-IV', 
  '{"authority_tier": 1, "canton": "Federal"}'::jsonb
),
(
  'iv_guideline_2025', 
  'iv_registration_process', 
  'How to Register for IV', 
  'You should register for IV as soon as you notice that a health impairment could threaten your job or your ability to perform daily tasks for a longer period (at least 6 months). Early detection is key. You can register using the official form "Anmeldung für Erwachsene: Berufliche Integration/Rente" available from your cantonal IV office.', 
  'https://www.ahv-iv.ch/en/Leaflets-forms/Forms/Invalidity-insurance-IV', 
  '{"authority_tier": 1, "canton": "Federal"}'::jsonb
),
(
  'zh_social_services', 
  'zh_supplementary_benefits', 
  'Supplementary Benefits in Zurich', 
  'If your IV pension and other income are not enough to cover your minimal living costs, you may be entitled to Supplementary Benefits (Ergänzungsleistungen/EL). In the Canton of Zurich, you must apply for EL at your municipal SVA office. The calculation considers your recognized expenses (rent, health insurance) versus your income.', 
  'https://www.svazurich.ch/el', 
  '{"authority_tier": 2, "canton": "ZH"}'::jsonb
)
ON CONFLICT (source_id, chunk_id) DO NOTHING;
