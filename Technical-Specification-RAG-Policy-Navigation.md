# Technical Specification
## Adaptive Personality-Aware Caregiver Assistant (v1)

**Spec Version:** 1.3.0  
**Last Updated:** 2026-03-04

### Changelog
- **1.3.0**: Locked runtime direction to Gemma 3 via NVIDIA/OpenAI-compatible endpoint and hybrid external memory (PostgreSQL + EMA + pgvector retrieval/write in workflow).
- **1.2.0**: Consistency hardening, multilingual and compliance additions, edge-case handling upgrades, scalability and observability refinements, and explicit governance updates.
- **1.1.0**: Added TypeScript-first architecture/framework/coding standards.
- **1.0.0**: Initial technical specification baseline.

## 1. Purpose and Scope

This specification defines the production-oriented technical design for a Swiss caregiver assistant with:
- personality-aware dialogue (OCEAN + EMA smoothing),
- Retrieval-Augmented Generation (RAG),
- policy navigation for Swiss caregiver support workflows.

This document is implementation-focused and aligned with the requirements in `pmt/Preliminary-Study-V2.7.6.md`.

## 2. System Goals

- Provide emotionally adaptive responses based on continuous OCEAN inference.
- Deliver grounded Swiss policy guidance with citations.
- Separate factual policy retrieval from personality-dependent presentation style.
- Ensure auditable, privacy-aware operation with reproducible logs and deterministic contracts.

## 3. High-Level Architecture

Core flow:
1. `User Input`
2. `Detection` (OCEAN + confidence)
3. `EMA State Update` (per trait)
4. `Regulation` (behavioral directives + mode)
5. `Generation`
6. `Verification`
7. `Persistence + Audit`
8. `Client Response`

Runtime components:
- `Frontend` (Next.js): chat UI, personality dashboard, policy response display.
- `Orchestrator` (N8N): workflow graph and service integration.
- `Model runtime` (Gemma 3): OpenAI-compatible endpoint with NVIDIA key-based authentication.
- `Policy/RAG services` (HTTP/Code nodes): retrieval, rerank, citation packaging.
- `Database` (PostgreSQL + pgvector): sessions, turns, personality states, policy evidence, metrics, and long-term memory embeddings.
- `Cache` (Redis, optional): session context and hot policy chunks.

## 4. Functional Requirements

### 4.1 Dialogue and Personality
- Infer O/C/E/A/N values continuously in range `[-1.0, +1.0]`.
- Infer per-trait confidence in `[0.0, 1.0]`.
- Apply EMA with default `alpha=0.3`.
- Block low-confidence updates with threshold `0.4`.
- Mark profile stable after sufficient consistent turns (target 6+ turns, variance threshold configurable).

### 4.2 RAG and Policy Navigation
- Detect policy-intent queries (benefits, eligibility, procedures, forms, canton-specific support).
- Retrieve top-k relevant policy chunks from trusted corpus.
- Return response with explicit citations and source metadata.
- Enforce no policy claim without source evidence.
- If retrieval fails, return safe fallback and ask clarifying question.

### 4.3 Personality-Styled Policy Delivery
- Policy facts are retrieval-grounded and invariant.
- Presentation style is adapted:
  - High C: structured checklist and ordered steps.
  - Low C: concise summary with optional details.
  - High N: reassuring framing and emotional containment.
  - High O: include alternatives and optional paths.
  - High A: collaborative phrasing.

### 4.4 Hybrid External Memory
- Use external memory only (no in-model latent checkpointing): `personality_states` + `conversation_turns` + `personality_memory_embeddings`.
- Retrieve memory snippets by vector similarity (`pgvector`) before detection/regulation/generation.
- Write compressed memory per turn after verification/output.
- Keep retrieval scoped by `session_id`; memory snippets are contextual aids and must not bypass verifier or grounding rules.

## 5. Non-Functional Requirements

- Availability target: degrade gracefully if upstream modules fail.
- Contract validity: JSON response schema compliance >= 99.5%.
- Latency targets (p95), aligned with pillar SLOs in `17.6.1`:
  - Emotional support/general dialogue: <= 4.0s
  - Practical education: <= 5.0s
  - Policy navigation: <= 8.0s
  - Mixed mode: <= 9.0s
- Security:
  - Secrets only in env vars.
  - Pseudonymized IDs in logs.
  - No raw sensitive personal content in analytics exports.

## 6. Data Contracts

### 6.1 Inbound Request

```json
{
  "session_id": "uuid",
  "turn_index": 1,
  "message": "user text",
  "context": {
    "language": "en",
    "language_auto_detected": "de",
    "canton": "ZH"
  }
}
```

Language policy:
- Minimum supported request/response languages for Swiss deployment: `de`, `fr`, `it`, `en`.
- Retrieval query rewriting and response generation should preserve user-preferred language whenever possible.

### 6.2 Detection Output

```json
{
  "ocean": {"O": 0.12, "C": 0.34, "E": -0.05, "A": 0.41, "N": 0.57},
  "confidence": {"O": 0.80, "C": 0.74, "E": 0.62, "A": 0.85, "N": 0.88},
  "reasoning": "short summary"
}
```

### 6.3 RAG Retrieval Output

```json
{
  "mode": "policy_navigation",
  "query_rewrite": "canonical retrieval query",
  "top_k": 3,
  "evidence": [
    {
      "source_id": "iv_guideline_2025_01",
      "title": "IV eligibility criteria",
      "url": "https://...",
      "chunk_id": "iv_13",
      "excerpt": "..."
    }
  ]
}
```

### 6.4 Final Response Output

```json
{
  "session_id": "uuid",
  "message": {
    "role": "assistant",
    "content": "final response",
    "timestamp": "ISO-8601"
  },
  "personality_state": {
    "ocean": {"O": 0.12, "C": 0.34, "E": -0.05, "A": 0.41, "N": 0.57},
    "confidence": {"O": 0.80, "C": 0.74, "E": 0.62, "A": 0.85, "N": 0.88},
    "stable": true,
    "ema_applied": true
  },
  "policy_navigation": {
    "active": true,
    "citations": [
      {
        "source_id": "iv_guideline_2025_01",
        "title": "IV eligibility criteria",
        "url": "https://..."
      }
    ]
  },
  "pipeline_status": {
    "detector": "ok",
    "regulator": "ok",
    "generator": "ok",
    "verifier": "ok",
    "retrieval": "ok",
    "fact_invariance_check": "pass"
  }
}
```

## 7. RAG Design

### 7.1 Corpus and Source Governance
- Source classes:
  - federal policy pages,
  - cantonal authority pages,
  - approved guidance documents.
- Each source record stores: `source_id`, `title`, `jurisdiction`, `publish_date`, `url`, `version_hash`.
- Each source record should also include: `authority_tier` (1-5), `validation_status`, and `expires_at`.
- Chunking strategy:
  - semantic chunking with overlap (200-400 tokens per chunk, 15-20% overlap),
  - preserve section headers for legal/procedural context.

Corpus governance controls:
- Only sources with `validation_status=approved` are eligible for production retrieval.
- Sources with `expires_at < now` are excluded until refreshed.
- Authority tier contributes to reranking in policy mode.

### 7.2 Retrieval Pipeline
1. Intent classifier (`policy_navigation` vs `general_support`).
2. Query normalization and expansion.
3. Hybrid retrieval:
   - vector similarity,
   - lexical keyword fallback for legal phrases.
4. Optional rerank by:
   - jurisdiction match (federal/canton),
   - recency,
   - source authority score.
5. Evidence packaging with citation metadata.

### 7.3 Grounding Rules
- Every policy claim in output must map to at least one evidence chunk.
- If evidence confidence below threshold:
  - do not assert eligibility as fact,
  - provide conditional guidance and official contact direction.
- Hard fail conditions:
  - fabricated references,
  - missing citation for policy claims.

## 8. Policy Navigation Specification

### 8.1 Supported Domain Packs (Phase Scope)
- Domain pack A: `IV / Invalidenversicherung`
- Domain pack B: `Hilflosenentschaedigung`

Each pack includes:
- FAQ benchmark set (20-30 Q/A),
- eligibility logic notes,
- required documents checklist,
- process steps,
- office/contact routing hints.

### 8.2 Navigation Modes
- `Explain`: summarize entitlement concept.
- `Eligibility`: evaluate likely fit with disclaimers.
- `Procedure`: provide step-by-step submission path.
- `Document Prep`: list required evidence and forms.
- `Escalation`: direct to official channels for edge cases.

### 8.3 Personality-Aware Rendering Layer
- Apply style transform after facts are fixed.
- Input: `{facts, citations, ocean, confidence}`
- Output: user-facing response with adapted tone/structure.
- Prohibited: modifying policy facts due to personality style.

## 8.4 Three-Pillar Runtime Implementation

Implement the three pillars as a single shared runtime with per-turn mode routing.

### A) Pillar Mode Contract

Each turn must carry:

```json
{
  "coaching_mode": "emotional_support | practical_education | policy_navigation",
  "mode_confidence": 0.0
}
```

Optional mixed-turn decomposition:

```json
{
  "coaching_mode": "mixed",
  "segments": [
    {"mode": "emotional_support", "weight": 0.4},
    {"mode": "policy_navigation", "weight": 0.6}
  ]
}
```

### B) Shared Core Pipeline (All Pillars)

For each incoming turn:
1. Ingest + session/context load
2. OCEAN detection + confidence
3. EMA update and stability check
4. Pillar router (`coaching_mode`)
5. Pillar-specific processing
6. Response verification
7. Persistence + audit logging
8. Return response

Core invariant:
- Personality state is always updated.
- Policy facts are never generated without evidence.

### C) Pillar A: Emotional Support (Personality-Regulated)

Components:
- stress/emotion classifier (`stress_level: 0..4`, `stress_drivers: []`)
- directive generator from OCEAN profile
- supportive response generator

Behavior rules:
- high N -> stronger reassurance and grounding language
- low N -> concise pragmatic framing
- high A -> collaborative and warm interaction
- low A -> direct and matter-of-fact style

Output requirements:
- include `regulation.directives`
- include `personality_state` from EMA-smoothed values
- set `policy_navigation.active=false` unless explicit policy sub-question is present

### D) Pillar B: Practical Education (Personality-Regulated)

Components:
- education planner (`topic -> steps -> micro-actions`)
- style adapter (detail depth and structure by O/C/E traits)
- optional retrieval for factual caregiving guidance

Behavior rules:
- high C -> checklist, sequence, clear completion criteria
- low C -> lightweight suggestions and flexible sequencing
- high O -> include alternative methods
- low O -> standard proven methods first

Output requirements:
- include `learning_plan` (steps, priorities, estimated effort)
- include `micro_actions` for immediate next-step execution

### E) Pillar C: Policy Navigation (RAG-Grounded, Personality-Styled)

Components:
- policy intent parser (benefit type, canton, eligibility/procedure/document intent)
- hybrid retriever (vector + lexical)
- citation packager and grounding verifier
- personality-aware renderer (presentation only)

Hard constraints:
- no policy claim without at least one evidence chunk
- if evidence confidence is low, output conditional guidance and ask clarification
- personality style may change wording/structure, not policy facts

Output requirements:
- `policy_navigation.active=true`
- non-empty `policy_navigation.citations[]`
- `pipeline_status.retrieval` populated (`ok|degraded|failed`)

### F) Router Decision Policy

Primary decision from intent score:
- `policy_navigation` when policy score >= 0.55 or legal/benefit trigger terms are present
- `practical_education` when user asks for techniques/plans/routines
- `emotional_support` default for emotional processing turns
- `mixed` when both policy and emotional intent exceed threshold

Fallback policy:
- ambiguous turns default to emotional support + one clarifying question

Mode decision table:

| Condition | Selected Mode | Notes |
|-----------|---------------|-------|
| policy score >= 0.55 | `policy_navigation` | Force citation-required path |
| education score >= 0.55 and policy score < 0.55 | `practical_education` | Structured coaching output |
| emotional score >= 0.55 and policy score < 0.55 | `emotional_support` | No policy assertions without retrieval |
| policy score >= 0.45 and emotional score >= 0.45 | `mixed` | Two-segment response composition |
| all scores < 0.55 | `emotional_support` | Ask one clarifying question |

Tie-break rules:
- If policy and education tie, choose `policy_navigation` when legal/benefit keywords are present.
- If emotional and education tie, choose `practical_education` when the user asks for explicit next steps.
- If all three tie at low confidence, default to `emotional_support` with clarification.
- Mode decision is primary; model-tier routing is applied second and cannot bypass required policy-grounding steps.

### G) N8N Branch Mapping

Recommended branch layout:
1. `Webhook Trigger`
2. `Normalize Input`
3. `Load Previous State`
4. `Detection Call`
5. `EMA Update`
6. `Mode Classifier`
7. Branch:
   - Branch A: `Emotional Pipeline`
   - Branch B: `Education Pipeline`
   - Branch C: `Policy RAG Pipeline`
8. `Unified Verifier`
9. `Save Turn + State + Evidence`
10. `Return Response`

### H) Persistence Requirements per Pillar

- All turns:
  - `conversation_turns.mode`
  - `personality_states` row (smoothed OCEAN + confidence + stability)
- Policy turns:
  - `policy_evidence` rows for each cited chunk
- All turns:
  - `performance_metrics` for detector/router/generator/verifier/retrieval stages

### I) Acceptance Criteria for Three-Pillar Runtime

- 100% of turns have a valid `coaching_mode`
- 100% of policy turns include at least one citation
- 0 policy assertions without retrieval evidence
- personality state update success >= 99.5% turns
- verifier blocks malformed or ungrounded outputs before return

### J) Mixed-Mode Response Composition Template

When `coaching_mode = mixed`, output should be assembled as two explicit segments:

1. **Support Segment** (emotional containment and tone alignment)
2. **Policy Segment** (facts, procedures, and citations)

Reference output shape:

```json
{
  "coaching_mode": "mixed",
  "message": {
    "role": "assistant",
    "content": "<support segment>\\n\\n<policy segment>",
    "timestamp": "ISO-8601"
  },
  "segments": [
    {"type": "support", "tokens": 80},
    {"type": "policy", "tokens": 110}
  ],
  "policy_navigation": {
    "active": true,
    "citations": [
      {"source_id": "iv_guideline_2025_01", "title": "IV eligibility criteria", "url": "https://..."}
    ]
  }
}
```

Composition constraints:
- Policy segment must include citations when policy claims are present.
- Support segment must not introduce unsupported policy claims.
- Combined response length remains within configured token budget.

## 9. Database Schema (Minimum)

- `chat_sessions(session_id, created_at, status, locale, canton)`
- `conversation_turns(session_id, turn_index, user_msg, assistant_msg, mode, latency_ms, created_at)`
- `personality_states(session_id, turn_index, ocean_json, confidence_json, stable, ema_alpha, created_at)`
- `policy_evidence(session_id, turn_index, source_id, chunk_id, title, url, excerpt_hash)`
- `performance_metrics(session_id, turn_index, stage, status, duration_ms, error_code, created_at)`

Indexes:
- `conversation_turns(session_id, turn_index)`
- `personality_states(session_id, turn_index)`
- `policy_evidence(source_id, chunk_id)`

## 10. Workflow Nodes (N8N Logical)

1. Webhook Trigger
2. Input Normalize
3. Load Previous Personality State
4. Build Memory Query Vector
5. Hybrid Memory Retrieve (pgvector)
6. Attach Hybrid Memory Context
7. Detection Call
8. EMA Update
9. Coaching Mode + Policy Intent Classification
10. RAG Retrieval (if policy intent)
11. Regulation
12. Generation
13. Verification (grounding + format + fact invariance)
14. Save Turn + State + Evidence
15. Build Memory Write Payload
16. Hybrid Memory Write (pgvector)
17. Return Response

## 11. Observability and Audit

- JSONL per turn with:
  - input hash,
  - detected traits/confidence,
  - retrieval ids,
  - citation list,
  - verifier decision,
  - final status.
- Correlation IDs across frontend, orchestrator, and DB writes.
- Redaction rules for personal names and contact details before long-term storage.
- Optional post-turn feedback signals (`thumbs_up_down`, `helpfulness_score`) should be captured for quality monitoring.
- Anomaly monitoring should include sudden trait-shift alerts, repeated retrieval failures, and citation-missing alerts in policy mode.

## 12. Failure Handling

- Detector failure: keep prior stable traits and move to neutral style.
- RAG failure: provide non-policy emotional support, request clarification, set `retrieval=degraded`.
- Verifier failure: safe fallback response with minimal claims.
- Upstream timeout: return controlled fallback JSON, never plain text error.
- EMA divergence (high oscillation): freeze updates, revert to last stable state, and emit an `ema_divergence` alert.
- Mixed-mode token overflow: prioritize policy segment facts/citations, then compress support segment.
- Language fallback failure: return in best detected language (or English fallback) with explicit notice.

## 13. Testing Strategy

- Unit:
  - EMA update logic,
  - confidence gating,
  - style renderer invariance on factual claims.
- Integration:
  - full detect->RAG->generate->verify pipeline.
- Evaluation:
  - benchmark policy Q/A packs,
  - citation coverage checks,
  - hallucination audit.
- Regression:
  - golden conversations for high-N, high-C, mixed profiles.
- Coverage/performance requirements:
  - branch coverage >= 90% for critical pipeline modules,
  - contract validation tests on all boundary payloads,
  - load-test baseline >=100 concurrent sessions without critical failures.
- Robustness:
  - fuzz tests for noisy OCEAN/confidence inputs,
  - adversarial prompt tests for policy hallucination resistance.

## 14. Acceptance Criteria

- OCEAN contract valid for >= 99.5% turns.
- Policy responses contain citations for 100% policy claims.
- No critical hallucination in audit set.
- RAG domain packs answer benchmark Q/A with target correctness threshold defined by evaluator protocol.
- Frontend shows non-empty OCEAN feedback whenever detection path is active (native or recovery detector path).

## 15. Implementation Notes

- Keep provider abstraction for model endpoints (`NVIDIA`, `OpenAI-compatible`).
- Runtime default:
  - `NVIDIA_API_URL`
  - `NVIDIA_API_KEY`
  - `NVIDIA_MODEL=google/gemma-3-12b-it`
- Expose feature flags:
  - `ENABLE_RAG_POLICY_NAV`,
  - `ENABLE_PERSONALITY_STYLING`,
  - `ENABLE_RECOVERY_DETECTOR`.
- Version policy packs separately from workflow code.

## 15.1 OpenClaw-Inspired Enhancements

This section captures production patterns inspired by OpenClaw-like gateway architectures and adapts them to this system.

### A) Gateway Control Plane

Add an explicit `Gateway` service in front of orchestration to centralize:
- session lifecycle and request correlation IDs,
- authN/authZ and rate limits,
- routing decisions (intent mode + model tier),
- retry/backoff policy and timeout budgets,
- tool invocation policy (allowed actions by mode).

Minimum gateway request envelope:

```json
{
  "request_id": "uuid",
  "session_id": "uuid",
  "user_id": "pseudonymous-id",
  "message": "text",
  "context": {"canton": "ZH", "language": "en"},
  "routing_hints": {"force_policy_mode": false}
}
```

### B) Dual Router Strategy

Use two coordinated routers:

1. **Intent Router** (`policy_navigation`, `emotional_support`, `practical_education`, `mixed`)
2. **Model Tier Router** (`light`, `medium`, `heavy`)

Routing policy:
- `light`: short non-policy turns, low reasoning depth
- `medium`: standard coaching + moderate policy complexity
- `heavy`: ambiguous eligibility/procedural edge-cases, verification retries, complex multi-step reasoning

This improves cost-performance while preserving response quality and safety guarantees.

Router precedence:
1. Intent router selects pillar mode (`emotional_support`, `practical_education`, `policy_navigation`, `mixed`).
2. Model-tier router selects compute tier (`light|medium|heavy`) for the selected mode.
3. Safety policies can escalate tier but cannot skip mandatory grounding/verification steps.

### C) Weighted Hybrid Retrieval Defaults

Formalize retrieval fusion score:

`final_score = 0.70 * vector_score + 0.30 * lexical_score + rerank_boost`

Suggested rerank boosts:
- `+0.08` jurisdiction/canton exact match
- `+0.05` higher authority source tier
- `+0.03` recency within policy validity window

Keep top `k=5` after fusion, then pass top `3` to generation by token budget.

### D) Tool Policy Manager

Define a policy matrix for tool/data access:
- `policy_navigation`: retrieval + citation tools required; no unsupported legal claims.
- `emotional_support`: no policy claim generation without retrieval evidence.
- `mixed`: retrieval tools enabled for factual segments only.

Hard rule: generation cannot output policy assertions unless at least one evidence chunk is attached.

### E) Scheduler and Background Ops

Add background jobs (cron/queue workers):
- policy corpus freshness checks (daily),
- source recrawl and re-embedding (scheduled/incremental),
- stale citation detector (link validity + version hash mismatch),
- retrieval quality regression suite on benchmark questions.

Emit structured job telemetry into `performance_metrics` with stage=`background_job`.
Use queue-backed workers for background tasks to support horizontal scaling and avoid orchestrator bottlenecks under load.

### F) Operational SLO Extensions

Add SLOs aligned with gateway model:
- Gateway availability >= 99.9%
- Routing decision latency p95 <= 50ms
- Retrieval stage timeout budget <= 2.0s
- Verification stage timeout budget <= 1.5s
- Citation attachment rate for policy mode = 100%

### G) Minimal Rollout Plan

1. Introduce gateway in shadow mode (observe only).
2. Enable model-tier routing for 10% traffic.
3. Enable weighted hybrid retrieval and compare citation/error metrics.
4. Turn on tool policy enforcement in blocking mode.
5. Activate scheduled corpus maintenance jobs.

Success gate for full rollout:
- no critical hallucination increase,
- stable or improved policy benchmark scores,
- reduced average inference cost at equal or better user-rated quality.

## 15.2 Architecture, Framework, and Coding Standards (TypeScript-First)

This project adopts a TypeScript-first implementation strategy for production maintainability, contract safety, and cross-service consistency.

### A) Reference Production Architecture

- `Gateway API` (entry point): authN/authZ, request normalization, routing, rate limits, correlation IDs.
- `Orchestrator` (N8N): workflow coordination for detect -> regulate -> retrieve -> generate -> verify.
- `Personality Service`: OCEAN inference + EMA update/state continuity.
- `RAG Service`: hybrid retrieval (vector + lexical), rerank, citation packaging.
- `Generation Service`: response synthesis from directives + evidence.
- `Verification Service`: grounding checks, contract checks, policy-claim safety gates.
- `Data Layer`: PostgreSQL + pgvector, Redis cache, JSONL audit logs.

### B) Framework Standards

- `Frontend`: Next.js (App Router) + React + TypeScript.
- `Gateway/Backend`: Node.js + NestJS (preferred) or Fastify (lightweight alternative), both in TypeScript.
- `Workflow`: N8N with strict JSON contracts between nodes/services.
- `Validation`: zod schemas (or class-validator DTOs) for request/response contracts.
- `Persistence`: PostgreSQL (+ pgvector for vector search), Redis for hot-state caching.
- `Realtime UX`: WebSocket/SSE channel for turn-status updates and progressive pipeline state display.
- `Accessibility`: UI implementation should align with WCAG 2.1 AA for caregiver accessibility needs.

### C) TypeScript Policy

- TypeScript is required for all Node.js services and frontend code.
- `tsconfig` baseline:
  - `"strict": true`
  - `"noImplicitAny": true`
  - `"noUncheckedIndexedAccess": true`
  - `"exactOptionalPropertyTypes": true`
- Ban untyped payload handling at service boundaries; all external payloads must be validated.

### D) Coding Standards

- Lint/format:
  - ESLint + Prettier required in CI.
  - No direct merge if lint/typecheck fails.
- Naming:
  - `PascalCase` for types/classes
  - `camelCase` for variables/functions
  - `SCREAMING_SNAKE_CASE` for env constants
- Error handling:
  - Never return raw stack traces to clients.
  - Use structured error envelopes with stable `error_code`.
- Logging:
  - Structured logs with `request_id`, `session_id`, `stage`, `status`, `latency_ms`.
  - Redact personal identifiers before persistent logs.

### E) Contract-First Development

- Define shared contracts in a dedicated package/module (for example: `@homecare-loop/contracts`).
- Version contracts semantically (`v1`, `v1.1`) and maintain backward compatibility for response fields.
- All inter-service and N8N node transitions must validate against these contracts.

### F) Testing and Quality Gates

- Required CI steps:
  - `lint`
  - `typecheck`
  - `unit tests`
  - `integration tests` (pipeline path)
- Minimum quality gates:
  - contract parse success >= 99.5%
  - policy citation coverage = 100% in policy mode
  - no critical hallucination in benchmark audit set

### G) Repository Structure (Recommended)

```text
homecare-loop/
  apps/
    web/                  # Next.js frontend (TypeScript)
    gateway/              # API gateway (TypeScript)
  services/
    personality-service/  # OCEAN + EMA
    rag-service/          # retrieval + rerank + citations
    generation-service/   # response synthesis
    verification-service/ # grounding + policy safety checks
  workflows/
    n8n/                  # workflow exports and contracts
  packages/
    contracts/            # shared zod/types
    config/               # eslint/tsconfig/shared config
  infra/
    docker/
    k8s/
```

## 16. Deliverables in This Spec Package

- This document (`Technical-Specification-RAG-Policy-Navigation.md`)
- New directory location:
  - `homecare-loop/`

## 17. Design Governance and Industry Standards

This chapter defines the software design model and compliance posture adopted for production deployment.

### 17.1 Adopted Software Design Model

CareLoop adopts a **TypeScript-first, contract-driven, service-oriented architecture** with a gateway and orchestrated runtime pipeline:

`ingest -> detect -> EMA -> route (3 pillars) -> retrieve (RAG when needed) -> generate -> verify -> persist`

Design principles:
- **Contract-first engineering** for all service boundaries and workflow node transitions.
- **Separation of concerns** between factual grounding (RAG) and personality styling (delivery form only).
- **Fail-safe defaults** for retrieval, verification, and timeout scenarios.
- **Traceable execution** through correlation IDs and structured audit logs.

### 17.2 Architecture Compliance Policy

Mandatory architecture rules:
- Policy claims must be evidence-grounded with citations.
- Personality adaptation must not alter policy facts.
- Every turn must include a valid mode decision and pipeline status.
- All inter-service payloads must pass schema validation before processing.
- No direct service-to-service contract bypass outside approved interfaces.

### 17.3 Engineering Standards Baseline

Code and repository standards:
- TypeScript strict mode enabled for all Node/Frontend services.
- ESLint + Prettier required; CI blocks merges on lint/type errors.
- Shared contracts package for DTO/schema reuse across services.
- Semantic versioning for APIs and contract changes.
- Branch protection and mandatory pull-request review for mainline merges.

### 17.4 Security and Privacy Standards

Security requirements:
- Use secret managers/environment variables only; no hardcoded credentials.
- Enforce least privilege for service accounts and data access paths.
- Redact personal identifiers in logs and analytics exports.
- Maintain auditable access and processing trails for sensitive operations.

Privacy requirements:
- Data minimization for personal content and session metadata.
- Pseudonymized identifiers for user/session-level observability.
- Retention and deletion policies aligned with Swiss FADP obligations.
- Explicit user consent is required before enabling personality profiling features.
- Data export/delete controls must support user requests for profile-related records.

### 17.5 Testing and Quality Gates

Pre-release quality gates:
- Contract parse success >= 99.5%
- Policy citation coverage = 100% in policy mode
- No critical hallucination in benchmark audit set
- End-to-end regression suite passed on three-pillar routing paths
- Verifier correctly blocks malformed or ungrounded responses

Required test layers:
- unit tests (logic and validators)
- integration tests (pipeline and branch behavior)
- end-to-end tests (API to UI behavior)
- policy benchmark audits (retrieval + citation fidelity)

### 17.6 Operational Standards (SLO and Release)

Operational baseline:
- Gateway availability >= 99.9%
- Routing decision latency p95 <= 50ms
- Retrieval timeout budget <= 2.0s
- Verification timeout budget <= 1.5s

Release governance:
- staged rollout (shadow -> canary -> general availability)
- rollback playbook and incident response ownership defined
- post-release quality monitoring with automated alert thresholds

### 17.6.1 Pillar-Level SLO Targets

Per-pillar SLOs:
- `emotional_support`
  - p95 latency <= 4.0s
  - style-fit evaluator score >= 4.0/5.0
- `practical_education`
  - p95 latency <= 5.0s
  - actionable-plan completeness >= 95% (step list present when requested)
- `policy_navigation`
  - p95 latency <= 8.0s
  - citation coverage = 100% for policy claims
  - critical hallucination rate = 0
- `mixed`
  - p95 latency <= 9.0s
  - both segment types present in >= 95% of mixed turns
  - citation coverage = 100% in policy segment

### 17.6.2 Pillar Test Matrix (Minimum)

| Pillar | Minimum Test Cases | Mandatory Assertions |
|--------|---------------------|----------------------|
| emotional_support | 30 | tone-fit >= target, no unsupported policy claims |
| practical_education | 30 | plan steps present, personality style applied |
| policy_navigation | 40 | citations present, no ungrounded policy assertions |
| mixed | 30 | support + policy segments both present, citations in policy segment |

Execution policy:
- Run matrix on every release candidate.
- Block production promotion on any critical safety or grounding failure.

### 17.7 Official Architecture Statement

**CareLoop adopts a TypeScript-first, contract-driven service architecture with verifiable RAG grounding, policy-safe generation, and production controls aligned with mainstream industry standards for quality, security, and reliability.**

