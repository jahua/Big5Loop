-- Hybrid external memory support for Gemma 3 runtime
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
