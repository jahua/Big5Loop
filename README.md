# CareLoop – Phase 0 & Phase 1 MVP

**Repository:** [github.com/jahua/CareLoop](https://github.com/jahua/CareLoop)

Phase 0: infrastructure, contracts, chat shell, N8N skeleton, DB schema.  
Phase 1: MVP dialogue loop (Detection stub → EMA → Mode stub → Build Response → Respond). Personality state and coaching mode are returned and shown in the UI.

## Quick start

1. **Environment**
   ```bash
   cp .env.example .env
   # Edit .env and set POSTGRES_PASSWORD (required for Docker).
   ```

2. **Start full stack (DB + N8N + Next.js)**
   ```bash
   cd CareLoop
   docker compose --env-file .env -f infra/docker/docker-compose.yml up --build
   ```
   For production build: `docker compose --env-file .env -f infra/docker/docker-compose.production.yml up --build -d`
   - **PostgreSQL** → `localhost:5432`
   - **N8N** → http://localhost:5678
   - **Next.js** → http://localhost:3000

   Or run only DB + N8N and run the frontend locally:
   ```bash
   docker compose --env-file .env -f infra/docker/docker-compose.yml up -d db n8n
   npm run dev --workspace=web
   ```

3. **Import N8N workflow(s)**
   - Open http://localhost:5678
   - **Full pipeline (Standard/Detailed):** Import and activate `workflows/n8n/careloop-phase1-2-postgres-mvp.json` (webhook `careloop-turn`).
   - **Simple mode (optional):** Import and activate `workflows/n8n/careloop-turn-simple.json` (webhook `careloop-turn-simple`) to use the frontend “Simple” mode. See [docs/TWO-WORKFLOWS-AND-MODE-SWITCH.md](docs/TWO-WORKFLOWS-AND-MODE-SWITCH.md).

4. **Run frontend** (only if you did not start the `web` service in Docker)
   ```bash
   cd CareLoop && npm install && npm run dev --workspace=web
   ```
   Or from `CareLoop/apps/web`: `npm install && npm run dev`
   - Open http://localhost:3000 (Docker) or the port Next.js prints (local dev). Send a message; Phase 1 responses include OCEAN and coaching mode.

5. **Contracts (typecheck + parse check)**
   ```bash
   cd CareLoop && npm install && npm run typecheck && npm run test:parse --workspace=@careloop/contracts
   ```

## Structure

- `apps/web` – Next.js (App Router) chat UI; `/api/chat` (proxy to N8N), `/api/personality/ema` (EMA state update).
- `packages/contracts` – Zod schemas (§6), EMA helpers, coaching mode types.
- `workflows/n8n` – Phase 0 skeleton and Phase 1 MVP (Detect → EMA → Mode → Build Response → Respond).
- `infra/database` – PostgreSQL init schema (§9).
- `infra/docker` – docker-compose for db + n8n + web (pgvector-ready Postgres).

**Keys and credentials:** See [docs/SECRETS-AND-CREDENTIALS.md](docs/SECRETS-AND-CREDENTIALS.md) for how we store and use secrets (env vars, N8N credential store, production secret managers).

**No policy chunks in DB?** Policy corpus ingestion is part of **Phase 2**. To seed the IV policy chunks: `npm run seed:policy` (with DB running; set `DATABASE_URL` if needed). See [docs/POLICY-CORPUS-INGESTION.md](docs/POLICY-CORPUS-INGESTION.md).

**Operations (Phase 3+):** Health check (`GET /api/health`), audit/feedback logs, data export/delete, and monitoring: see [docs/OPERATIONS-RUNBOOK.md](docs/OPERATIONS-RUNBOOK.md). Optional **gateway** entry: `POST /api/gateway/chat` (envelope, optional auth/rate limit, model_tier). **Background jobs:** `npm run job:corpus-freshness` (corpus check), `npm run job:retrieval-smoke` (one policy question → assert content + citations; set `BASE_URL` if needed). Phase 4 pilot: [docs/PHASE4-PILOT-CHECKLIST.md](docs/PHASE4-PILOT-CHECKLIST.md).

## DoD (Phase 0)

- [x] Repo structure and contracts
- [x] DB schema and docker compose (db + n8n)
- [x] Chat shell calling N8N webhook; stub response with `message.content`
- [ ] One “hello” turn flows Webhook → Normalize → Stub → (optional DB) → Client after you import and activate the workflow
- [ ] CI: lint, typecheck, contract parse (see `.github/workflows/ci.yml`)


## Gemma 3 + Hybrid Memory

- Runtime model target: `google/gemma-3-12b-it` via OpenAI-compatible endpoint (vLLM/TGI).
- Memory strategy: PostgreSQL audit + EMA state + vector retrieval (pgvector) for long-term personalization.
- Workflow baseline: `workflows/n8n/careloop-phase1-2-postgres-mvp.json`.
- Integration guide: `docs/GEMMA3-HYBRID-MEMORY.md`.
