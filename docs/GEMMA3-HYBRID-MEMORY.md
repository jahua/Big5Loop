# Gemma 3 + Hybrid External Memory (Recommended)

This project adopts the following direction:

- **Model runtime**: Gemma 3 (`google/gemma-3-12b-it`) on local NVIDIA GPU using OpenAI-compatible serving (vLLM/TGI).
- **Memory strategy**: external hybrid memory (PostgreSQL audit + EMA state + vector retrieval), not in-model latent checkpointing.

## Why this choice

- Lower cost and better data control than frontier hosted APIs.
- Keeps current architecture stable (N8N + Postgres + RAG).
- Improves long-term personalization with retrieval while preserving compliance/audit trails.

## Environment variables

Set in `.env`:

```env
NVIDIA_API_URL=http://host.docker.internal:8000/v1/chat/completions
NVIDIA_API_KEY=replace_with_nvidia_build_key
NVIDIA_MODEL=google/gemma-3-12b-it
MEMORY_RETRIEVAL_TOP_K=5
MEMORY_EMBEDDING_MODEL=BAAI/bge-m3
```

## Database extension

Use pgvector-ready Postgres image (`pgvector/pgvector:pg16`) and run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Suggested hybrid memory table

```sql
CREATE TABLE IF NOT EXISTS personality_memory_embeddings (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL,
  turn_index INT NOT NULL,
  memory_text TEXT NOT NULL,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Retrieval pattern in workflow

1. After ingest: create query embedding from current user message.
2. Retrieve top-k (`MEMORY_RETRIEVAL_TOP_K`) rows by cosine distance for same `session_id`.
3. Inject retrieved memory snippets into detection/regulation prompts.
4. After response: write a new compressed memory item + embedding.

## Existing workflow baseline

`workflows/n8n/careloop-phase1-2-postgres-mvp.json` now already includes:

- `Build Memory Query Vector` + `Hybrid Memory Retrieve (pgvector)` + `Attach Hybrid Memory Context` before detection
- `Build Memory Write Payload` + `Hybrid Memory Write (pgvector)` before response return
