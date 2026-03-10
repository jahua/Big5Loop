# Big5Loop Roadmap

**Version:** 1.5.0  
**Last Updated:** 2026-03-06  
**Scope:** Implementation roadmap aligned with `Technical-Specification-RAG-Policy-Navigation.md` (Spec v1.3.0)

### Phase 1–2 completion summary (as of 2026-03-04)
- **Pipeline:** Phase 1 + Phase 2 pipeline is implemented end-to-end (Detect → Regulate → Retrieve → Generate → Ground → Verify → Format). Coaching modes, RAG retrieval, citations, grounding verifier, and mixed mode are in place.
- **Deferred to after Phase 3:** (1) Latency validation (p95 targets), (2) `personality_memory_embeddings` read/write path, (3) Policy benchmark suite + evaluator protocol, (4) Optional: `ENABLE_RAG_POLICY_NAV` feature flag. See §4.3 and §5.3 DoD and `Big5Loop/docs/PHASE1-2-TODO.md`.

---

## 1. Overview

This roadmap defines a phased implementation plan for the **Adaptive Personality-Aware Caregiver Assistant**. It follows the architecture and contracts in the technical specification and delivers a runnable system incrementally, then strengthens reliability, observability, and compliance.

**Principles:**
- Deliver a working end-to-end loop first, then improve quality and stability.
- Keep factual grounding (RAG/policy evidence) strictly separate from personality styling.
- Each phase has clear deliverables and Definition of Done (DoD).
- Support Swiss deployment: multilingual (de, fr, it, en), auditability, and governance.

### 1.1 Architecture Lock (Current)
- Runtime model path is fixed to `google/gemma-3-12b-it` via OpenAI-compatible endpoint using `NVIDIA_API_KEY`.
- Memory path is fixed to hybrid external memory: PostgreSQL audit + EMA state + `pgvector` retrieval/write in N8N workflow.
- Legacy latent-memory microservice path is not part of the active roadmap.

---

## 2. High-Level Timeline

| Phase | Period | Focus |
|-------|--------|--------|
| **Phase 0** | Dec 2025 (Weeks 1–2) | Infrastructure and engineering baseline |
| **Phase 1** | Jan 2026 (Weeks 3–6) | MVP dialogue loop (Detection → Regulation → Generation) |
| **Phase 2** | Jan–Feb 2026 (Weeks 7–10) | RAG and policy navigation |
| **Phase 3** | Feb 2026 (Weeks 11–13) | Reliability, observability, and security |
| **Phase 4** | Feb–Mar 2026 (Weeks 14–16) | Pilot release and evaluation |

---

## 3. Phase 0: Infrastructure and Engineering Baseline (Dec 2025, Weeks 1–2)

### 3.1 Goals
- Establish a minimal runnable stack and dev environment.
- Freeze data contracts and module boundaries to reduce rework.

### 3.2 Tasks
- **Repository structure:** Set up `apps/`, `services/`, `workflows/`, `packages/`, `infra/` per Spec §15.2.G.
- **Frontend:** Next.js (App Router) + TypeScript; basic layout and chat shell.
- **Orchestrator:** N8N workflow skeleton (webhook → normalize → stub nodes → response).
- **Database:** PostgreSQL with initial schema per Spec §9:
  - `chat_sessions`, `conversation_turns`, `personality_states`, `policy_evidence`, `performance_metrics`.
- **Contracts:** Define and freeze v1 JSON contracts (request, detection, retrieval, final response) in `packages/contracts` with zod (or equivalent).
- **Environment:** `.env.example`, secrets-only config; no hardcoded credentials (Spec §17.4).
- **Model runtime env:** include `NVIDIA_API_URL`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`.
- **TypeScript:** Strict mode, shared `tsconfig`; lint/format (ESLint + Prettier) in CI.

### 3.3 Deliverables (DoD)
- [ ] `docker compose` (or equivalent) brings up frontend, N8N, and DB.
- [ ] Single “hello” turn flows: Webhook → Normalize → Stub Response → DB write → Client.
- [ ] All service boundaries validate against shared contracts.
- [ ] CI runs lint, typecheck, and contract parse checks.

---

## 4. Phase 1: MVP Dialogue Loop (Jan 2026, Weeks 3–6)

### 4.1 Goals
- Implement the core pipeline: **Detection → EMA → Regulation → Generation → Verification → Persistence**.
- Support **Emotional Support** and **Practical Education** pillars first (no RAG yet).
- Personality state (OCEAN + confidence + EMA) is updated and persisted every turn.

### 4.2 Tasks
- **Detection:** OCEAN inference + per-trait confidence; output conforms to Spec §6.2.
- **EMA:** State update with `alpha=0.3`; block updates when confidence &lt; 0.4 (Spec §4.1); stability after ~6 consistent turns.
- **Mode router:** Intent classification for `emotional_support` vs `practical_education`; default to emotional support when ambiguous (Spec §8.4.F).
- **Regulation:** Behavioral directives from OCEAN profile; style rules for high/low C, N, A, O (Spec §4.3, §8.4.C–D).
- **Generation:** Response synthesis from directives; no policy claims in this phase.
- **Verification:** Format and contract checks; block malformed outputs (Spec §8.4.I).
- **Persistence:** Save turn, personality state, and pipeline status per Spec §8.4.H.
- **Hybrid memory (MVP-ready):** add query-vector build, top-k pgvector retrieval, context attach, and post-response memory write.
- **Frontend:** Chat UI, display assistant message and (optional) personality dashboard placeholder.

### 4.3 Deliverables (DoD)
- [x] 100% of turns have valid `coaching_mode` (`emotional_support` or `practical_education`).
- [x] Personality state update success ≥ 99.5% of turns (Spec §14).
- [x] Verifier blocks malformed or ungrounded outputs before return.
- [x] Grounding Verifier (P1-9) validates policy claims against evidence.
- [x] Golden/conversation tests for at least two profiles (e.g. high-N, high-C) pass.
- [ ] p95 latency for emotional support ≤ 4.0s, practical education ≤ 5.0s (Spec §17.6.1).
- [ ] Memory retrieval/write path is active for conversation turns and observable in DB table `personality_memory_embeddings`.

---

## 5. Phase 2: RAG and Policy Navigation (Jan–Feb 2026, Weeks 7–10)

### 5.1 Goals
- Add **Policy Navigation** pillar with RAG retrieval, citations, and grounding.
- Enforce: no policy claim without evidence; safe fallback when retrieval fails.
- Personality affects only presentation of policy facts, not the facts themselves.

### 5.2 Tasks
- **Corpus and governance:** Source records with `source_id`, `title`, `jurisdiction`, `validation_status`, `expires_at`; only `approved` sources in production (Spec §7.1).
- **Chunking:** Semantic chunks (e.g. 200–400 tokens, 15–20% overlap); preserve section context.
- **Intent + retrieval:** Policy-intent detection (Spec §4.2); hybrid retrieval (vector + lexical) per Spec §7.2; optional rerank (jurisdiction, recency, authority).
- **Evidence packaging:** Top-k chunks with citation metadata; output shape per Spec §6.3.
- **Generation:** Policy segment uses only provided evidence; personality-style rendering applied after facts are fixed (Spec §8.3).
- **Verification:** Grounding check—every policy claim maps to ≥1 evidence chunk; hard fail on fabricated refs or missing citations (Spec §7.3, §8.4.I).
- **Domain packs:** At least one pack (e.g. IV / Invalidenversicherung) with FAQ benchmark, eligibility notes, procedure steps (Spec §8.1).
- **Navigation modes:** Support Explain, Eligibility, Procedure, Document Prep, Escalation as in Spec §8.2.
- **Mixed mode:** When intent is mixed, compose support segment + policy segment with citations only in policy segment (Spec §8.4.J).
- **Feature flag:** `ENABLE_RAG_POLICY_NAV` to toggle policy pillar (Spec §15).

### 5.3 Deliverables (DoD)
- [ ] 100% of policy turns include ≥1 citation; 0 policy assertions without retrieval evidence (Spec §14).
- [ ] Benchmark policy Q/A set meets target correctness (evaluator protocol).
- [ ] Citation coverage and no critical hallucination in audit set.
- [ ] p95 latency for policy_navigation ≤ 8.0s, mixed ≤ 9.0s (Spec §17.6.1).
- [x] RAG failure path returns safe fallback and clarification prompt; `retrieval=degraded` set (Spec §12).

---

## 6. Phase 3: Reliability, Observability, and Security (Feb 2026, Weeks 11–13)

**Implementation report:** `Big5Loop/docs/reports/Phase3-Reliability-Observability-Report.md`  
**TODO list:** `Big5Loop/docs/PHASE3-TODO.md`

### Phase 3 completion summary (as of 2026-03-04)
- **DoD 1–3 met:** Structured error envelopes (API + N8N pass-through), audit JSONL + optional `audit_log` DB write, correlation IDs, optional feedback (thumbs/score), redaction policy, health check, SLO/alert doc, security and data export/delete documentation.
- **Remaining for production:** Export/delete API with auth; workflow stage latency → `performance_metrics`; gateway (P2) and model-tier router when needed.
- **New implementation baseline (2026-03-06):** Session-isolated routing metadata is now carried through the web app, gateway, chat route, and audit trail (`route_key`, isolation scope, history usage). A lightweight operations dashboard now exposes session review, citation quality, degraded retrieval cases, feedback signals, audit visibility, and source freshness.

### 6.1 Goals
- Harden failure handling, logging, and audit.
- Introduce gateway (shadow then active), model-tier routing, and operational SLOs.
- Align with security and privacy standards (Spec §17.4).

### 6.2 Tasks
- **Failure handling:** Implement Spec §12: detector fallback (keep prior stable traits), RAG fallback (no policy, ask clarification), verifier fallback (minimal claims), timeout fallback (controlled JSON only), EMA divergence alert.
- **Audit:** JSONL per turn with input hash, traits, retrieval IDs, citations, verifier decision (Spec §11); correlation IDs across frontend, orchestrator, DB.
- **Session-isolated routing:** Carry `route_key`, isolation scope, and history-usage metadata through gateway/chat responses and persist them in audit records so emotional, educational, policy, and mixed turns remain traceable.
- **Redaction:** Pseudonymized IDs in logs; no raw sensitive content in analytics (Spec §5, §17.4).
- **Gateway (optional but recommended):** Session lifecycle, correlation IDs, authN/authZ, rate limits, routing; shadow mode first (Spec §15.1.A, §15.1.G).
- **Model-tier router:** Light / medium / heavy tiers for cost-quality tradeoff; cannot skip grounding/verification (Spec §15.1.B).
- **Background jobs:** Corpus freshness checks, citation validity, retrieval regression suite (Spec §15.1.E).
- **SLO monitoring:** Gateway availability ≥ 99.9%; routing p95 ≤ 50ms; retrieval timeout ≤ 2.0s; verification ≤ 1.5s (Spec §15.1.F, §17.6).
- **Operations dashboard:** Add a pilot-facing dashboard for session review, citation coverage, degraded retrieval monitoring, feedback analysis, audit-trail visibility, and source freshness status.
- **Security:** Secrets in env only; least privilege; retention/deletion aligned with Swiss FADP; consent for personality profiling (Spec §17.4).

### 6.3 Deliverables (DoD)
- [x] All failure paths return structured responses; no raw stack traces to clients.
- [x] Audit JSONL and correlation IDs available for every turn.
- [x] Optional feedback signals (e.g. thumbs up/down) captured for quality monitoring.
- [x] Session routing metadata (`route_key`, isolation scope, history usage) captured in gateway/chat/audit path for observability.
- [x] Lightweight operations dashboard available in the web app for pilot and research monitoring.
- [ ] If gateway is enabled: rollout plan followed (shadow → canary); success gate: no critical hallucination increase, stable or better benchmark scores (Spec §15.1.G).

---

## 7. Phase 4: Pilot Release and Evaluation (Feb–Mar 2026, Weeks 14–16)

**Checklist:** `Big5Loop/docs/PHASE4-PILOT-CHECKLIST.md` (pillar test matrix, SLO targets, benchmark audit, load test, rollout).

### 7.1 Goals
- Prepare for pilot deployment with real users (or internal testers).
- Run full evaluation suite and pillar test matrix; tune and document findings.

### 7.2 Tasks
- **Pillar test matrix:** Execute minimum cases per Spec §17.6.2 (emotional_support 30, practical_education 30, policy_navigation 40, mixed 30) with mandatory assertions.
- **Benchmark audit:** Policy Q/A packs, citation coverage, hallucination audit; block release on critical safety/grounding failures.
- **Load test:** ≥100 concurrent sessions without critical failures (Spec §13).
- **Accessibility:** Align UI with WCAG 2.1 AA where applicable (Spec §15.2.B).
- **Multilingual:** Request/response in de, fr, it, en; language preserved across retrieval and generation (Spec §6.1).
- **Rollout:** Staged rollout (shadow → canary → GA); rollback playbook and incident ownership defined (Spec §17.6).
- **Documentation:** Runbook for operations; contract changelog and versioning (e.g. v1, v1.1).

### 7.3 Deliverables (DoD)
- [ ] Full pillar test matrix passed; no critical safety or grounding failures.
- [ ] Load and regression suites green.
- [ ] Pilot environment deployed with monitoring and alert thresholds.
- [ ] Release governance and rollback process documented.

---

## 8. Dependencies and References

- **Technical spec:** `Big5Loop/Technical-Specification-RAG-Policy-Navigation.md` (v1.3.0)
- **Requirements:** `pmt/Preliminary-Study-V2.7.6.md` (as referenced in spec)
- **Contracts:** Defined in spec §6 (request, detection, retrieval, response); implement in `packages/contracts`
- **Phase 3 TODO:** `Big5Loop/docs/PHASE3-TODO.md` (reliability, observability, security)
- **Operations runbook:** `Big5Loop/docs/OPERATIONS-RUNBOOK.md` (env, health, audit, export/delete, monitoring, Phase 3→4)
- **Frontend improvements:** `Big5Loop/docs/FRONTEND-IMPROVEMENTS-TODO.md` (display, KPI/metrics, logs, user history, visual design; references `pmt/MVP/frontend` and `pmt/MVP/nextchat-personality-enhanced`)

---

## 9. Roadmap Changelog

- **1.5.0:** Codified three pipeline invariants (Spec §4.6): (1) OCEAN detection + regulation always run for every mode, (2) retrieval is conditional, (3) grounding verification mandatory for factual/policy content. Implemented hybrid LLM router (Spec §4.7) with confidence threshold, heuristic fallback, caching, and hard safety overrides. N8N workflow V2 (`big5loop-phase1-2-postgres-mvp-v2.json`) now consumes `routing_hints.target_mode` from the API. API route enforces invariants with diagnostic flags (`ocean_detection_skipped`, `regulation_skipped`, `grounding_check`).
- **1.4.2:** Added implemented OpenClaw-inspired session isolation and routing metadata flow (`route_key`, isolation scope, history usage) across web → gateway → chat → audit, plus a web operations dashboard for session review, citation quality, degraded retrieval, feedback analysis, audit visibility, and source freshness monitoring. Updated roadmap timestamp.
- **1.4.1:** Roadmap progress sync based on implementation evidence from `docs/PHASE1-2-TODO.md` and `docs/PHASE3-TODO.md`. Marked Phase 1 golden regression tests as completed and Phase 2 RAG degraded fallback DoD as completed. Updated roadmap timestamp.
- **1.4.0:** Routing/intent/mode design doc (`docs/ROUTING-AND-INTENT-DESIGN.md`): clean separation — intent in N8N workflow (authoritative), model tier in gateway, workflow selection in gateway, API fallback demoted and renamed. Updated gateway, model-tier, two-workflows docs with cross-references. Phase 3 report §2.10 added. N8N `Enhanced Regulation` upgraded toward Spec §8.4.F with normalized thresholds, tie-break rules, and low-confidence clarification metadata. N8N now consumes `context.model_tier` with policy safety escalation (`light`→`medium`), dynamic retrieval top-k, and tier-aware generation params. Added stale citation detector job (`npm run job:stale-citation`) and source recrawl/re-embedding baseline job (`npm run job:source-recrawl`) with JSONL telemetry. Added gateway baseline capture (`npm run job:gateway-baseline-capture`), canary gate script (`npm run job:gateway-canary-check`), and gateway shadow response logging.
- **1.3.0:** P2 gateway (shadow, optional auth `GATEWAY_API_KEY`, rate limit `GATEWAY_RATE_LIMIT_PER_MINUTE`, model_tier pass-through); model-tier router design (`docs/MODEL-TIER-ROUTER-DESIGN.md`); background jobs design + corpus-freshness script (`npm run job:corpus-freshness`); Phase 4 pilot checklist and pillar test matrix execution guide; Phase 3 report updated; stage latency / performance_metrics note in SLO doc.
- **1.2.0:** Phase 3 core complete: DoD 1–3 done (error envelope, audit + optional DB, feedback, redaction, health, SLO/alert doc, export/delete doc). Added Phase 3 completion summary under §6; stub routes for data export/delete (501 until auth and DB wired).
- **1.1.0:** Locked architecture to Gemma 3 (NVIDIA key) and hybrid external memory (PostgreSQL + EMA + pgvector). Dependencies updated to Spec v1.3.0; Phase 3 TODO link added.
- **1.0.0:** Initial roadmap aligned with Technical Specification v1.2.0.
