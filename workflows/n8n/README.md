# N8N workflows

## Phase 0 skeleton

Import `careloop-phase0-skeleton.json` in N8N (http://localhost:5678):

1. Workflow → Import from File → select `careloop-phase0-skeleton.json`
2. Activate the workflow.
3. POST to `http://localhost:5678/webhook/careloop-turn` with body:
   ```json
   {
     "session_id": "<uuid>",
     "turn_index": 1,
     "message": "Hello",
     "context": { "language": "en", "canton": "ZH" }
   }
   ```
4. Response matches §6.4 (Final Response Output) with stub content.

To persist turns: add PostgreSQL credentials in N8N and connect the optional Insert Session / Insert Turn nodes (see workflow comments).

---

## Phase 1 MVP (Detection → EMA → Mode → Build Response → Respond)

Import `careloop-phase1-mvp.json`:

1. Import and activate the workflow.
2. **Run Next.js on the host** so the EMA step can call `http://host.docker.internal:3000/api/personality/ema`.  
   From CareLoop root: `npm run dev --workspace=web` (or `cd apps/web && npm run dev`).
3. If N8N runs on the same host (not in Docker), change the EMA Code node URL to `http://localhost:3000/api/personality/ema`.
4. Response includes `personality_state` (OCEAN + stable + ema_applied) and `coaching_mode` (e.g. `emotional_support`).
5. Frontend shows OCEAN and mode when the response contains them.

---

## Imported from `pmt/MVP/workflows/N8N/phase1-2-postgres.json`

Import `careloop-phase1-2-postgres-mvp.json`:

1. Workflow -> Import from File -> select `careloop-phase1-2-postgres-mvp.json`
2. Activate the workflow.
3. This is adapted from the MVP file you pointed to: `pmt/MVP/workflows/N8N/phase1-2-postgres.json`.
4. Webhook path is normalized to `careloop-turn` for CareLoop frontend compatibility.
5. Configure PostgreSQL credential in N8N as **CareLoop PostgreSQL** before enabling DB writes.
6. Set NVIDIA runtime env in `CareLoop/.env`: `NVIDIA_API_URL`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`.
7. This workflow already includes hybrid memory nodes:
   - `Build Memory Query Vector` → `Hybrid Memory Retrieve (pgvector)` → `Attach Hybrid Memory Context`
   - `Build Memory Write Payload` → `Hybrid Memory Write (pgvector)`


---

## Gemma 3 + Hybrid External Memory

Recommended production direction for this repo:

1. Keep `careloop-phase1-2-postgres-mvp.json` as core runtime workflow.
2. Serve Gemma 3 (`google/gemma-3-12b-it`) via OpenAI-compatible API (vLLM/TGI).
3. Keep PostgreSQL for audit + EMA state; add pgvector retrieval for long-term memory recall.
