# Phase 0: Infrastructure and Engineering Baseline

**CareLoop Development Report**  
**Version:** 1.0  
**Status:** Completed  
**Duration:** Weeks 1–2

---

## 1. Introduction

Phase 0 established the foundational infrastructure for the CareLoop adaptive personality-aware caregiver assistant. This phase focused on creating a minimal runnable stack, freezing data contracts, and defining module boundaries to minimize rework in subsequent development phases. The primary objective was to ensure that all downstream implementation could proceed on a stable, well-defined technical foundation.

## 2. Technical Implementation

### 2.1 Repository Structure

The project adopted a monorepo architecture organized according to the technical specification guidelines. The directory structure separates concerns across distinct functional domains:

- **apps/web**: Next.js frontend application using App Router and TypeScript, providing the chat user interface and personality dashboard placeholder.
- **packages/contracts**: Shared Zod schemas defining request, detection, retrieval, and response contracts with strict type validation.
- **workflows/n8n**: N8N workflow definitions for orchestrating the dialogue pipeline.
- **infra/database**: PostgreSQL initialization scripts with schema definitions.
- **infra/docker**: Docker Compose configurations for containerized deployment.

This structure enforces separation between frontend, backend services, workflow orchestration, and infrastructure, enabling independent development and testing of each component.

### 2.2 Frontend Foundation

The frontend was implemented using Next.js 14 with the App Router paradigm. TypeScript strict mode was enabled with the following configuration constraints:

```typescript
{
  "strict": true,
  "noImplicitAny": true,
  "noUncheckedIndexedAccess": true
}
```

The initial implementation included a basic chat shell capable of sending user messages to the N8N webhook endpoint and displaying assistant responses. The chat interface was designed with extensibility in mind, allowing for future integration of personality state visualization and policy citation displays.

### 2.3 Orchestrator Skeleton

N8N was selected as the workflow orchestration platform due to its visual workflow design capabilities and native support for HTTP webhooks, code nodes, and database integrations. The Phase 0 skeleton workflow implemented the minimal viable pipeline:

1. **Webhook Trigger**: Receives incoming chat requests at `/webhook/careloop-turn`
2. **Input Normalize**: Validates and normalizes the request payload
3. **Stub Response**: Generates a placeholder response for testing
4. **Return Response**: Sends the formatted response to the client

This skeleton validated the end-to-end communication path from frontend to orchestrator and back, confirming that the infrastructure could support the full dialogue pipeline.

### 2.4 Database Schema

PostgreSQL was deployed with the pgvector extension to support future vector similarity operations. The initial schema included five core tables:

| Table | Purpose |
|-------|---------|
| `chat_sessions` | Session lifecycle management with locale and canton metadata |
| `conversation_turns` | Individual turn storage with user/assistant messages and mode |
| `personality_states` | OCEAN trait values, confidence scores, and stability flags per turn |
| `policy_evidence` | Cited policy chunks with source metadata |
| `performance_metrics` | Stage-level latency and status tracking |

Appropriate indexes were created on session_id and turn_index columns to optimize query performance for state retrieval operations.

### 2.5 Contract Definitions

Data contracts were defined using Zod schemas in the `@careloop/contracts` package. The v1 contracts specify:

- **Inbound Request**: session_id, turn_index, message, context (language, canton)
- **Detection Output**: OCEAN values [-1.0, +1.0], per-trait confidence [0.0, 1.0], reasoning
- **RAG Retrieval Output**: mode, query_rewrite, top_k, evidence array
- **Final Response**: message, personality_state, policy_navigation, pipeline_status

All inter-service communications must validate against these contracts, ensuring type safety and preventing schema drift.

### 2.6 Environment Configuration

Environment variables were structured to separate configuration from code. The `.env.example` template documents required variables without exposing actual credentials:

- `POSTGRES_PASSWORD`: Database authentication
- `NVIDIA_API_URL`: Model runtime endpoint
- `NVIDIA_API_KEY`: API authentication
- `NVIDIA_MODEL`: Target model identifier (google/gemma-3-12b-it)

No hardcoded credentials exist in the codebase, adhering to security best practices outlined in the technical specification.

## 3. Deliverables Achieved

The following Definition of Done criteria were satisfied:

- [x] Docker Compose brings up frontend, N8N, and database services
- [x] Single "hello" turn flows through Webhook → Normalize → Stub → Client
- [x] All service boundaries validate against shared contracts
- [x] CI pipeline runs lint, typecheck, and contract parse checks

## 4. Verification

The infrastructure was verified through the following tests:

```bash
# Start full stack
docker compose --env-file .env -f infra/docker/docker-compose.yml up --build

# Verify services
curl -X POST http://localhost:5678/webhook/careloop-turn \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test-123","turn_index":1,"message":"hello"}'

# Contract validation
npm run typecheck
npm run test:parse --workspace=@careloop/contracts
```

All verification steps completed successfully, confirming that the infrastructure baseline was ready for Phase 1 development.

## 5. Technical Decisions

### 5.1 Architecture Lock

The runtime architecture was locked to the following configuration:

- **Model Runtime**: google/gemma-3-12b-it via NVIDIA OpenAI-compatible endpoint
- **Memory Strategy**: Hybrid external memory using PostgreSQL audit trails, EMA state persistence, and pgvector for retrieval operations
- **Legacy Path Exclusion**: Latent-memory microservice patterns were explicitly excluded from the active roadmap

### 5.2 TypeScript-First Policy

All Node.js services and frontend code require TypeScript with strict mode enabled. This decision ensures type safety at compile time, reduces runtime errors, and improves developer experience through IDE autocompletion and error detection.

## 6. Lessons Learned

Phase 0 revealed several insights that informed subsequent development:

1. **Contract-first development** significantly reduced integration friction between frontend and orchestrator components.
2. **Docker Compose orchestration** simplified local development but required careful attention to service startup ordering and health checks.
3. **N8N workflow portability** required explicit JSON export/import procedures and documentation for team collaboration.

## 7. Transition to Phase 1

With the infrastructure baseline established, Phase 1 development could proceed with confidence that:

- The communication paths between all system components were operational
- Data contracts were stable and validated
- The development environment was reproducible across team members
- CI/CD pipelines would catch contract violations and type errors early

---

**Document Control**  
Author: CareLoop Development Team  
Last Updated: 2026-03-04
