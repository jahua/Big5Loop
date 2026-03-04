-- CareLoop Phase 0 schema per Technical Specification §9
-- Run once on fresh PostgreSQL (e.g. docker exec or init volume)

CREATE TABLE IF NOT EXISTS chat_sessions (
  session_id   UUID PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'active',
  locale       TEXT,
  canton       CHAR(2)
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
