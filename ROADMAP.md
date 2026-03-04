# CareLoop Roadmap

**Version:** 1.1.0  
**Last Updated:** 2026-03-04  
**Scope:** Implementation roadmap aligned with `Technical-Specification-RAG-Policy-Navigation.md` (Spec v1.3.0)

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

## 2. High-Level Timeline (Suggested 16 Weeks)

| Phase | Weeks | Focus |
|-------|--------|--------|
| **Phase 0** | 1–2 | Infrastructure and engineering baseline |
| **Phase 1** | 3–6 | MVP dialogue loop (Detection → Regulation → Generation) |
| **Phase 2** | 7–10 | RAG and policy navigation |
| **Phase 3** | 11–13 | Reliability, observability, and security |
| **Phase 4** | 14–16 | Pilot release and evaluation |

---

## 3. Phase 0: Infrastructure and Engineering Baseline (Weeks 1–2)

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

## 4. Phase 1: MVP Dialogue Loop (Weeks 3–6)

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
- [ ] 100% of turns have valid `coaching_mode` (`emotional_support` or `practical_education`).
- [ ] Personality state update success ≥ 99.5% of turns (Spec §14).
- [ ] Verifier blocks malformed or ungrounded outputs before return.
- [ ] Golden/conversation tests for at least two profiles (e.g. high-N, high-C) pass.
- [ ] p95 latency for emotional support ≤ 4.0s, practical education ≤ 5.0s (Spec §17.6.1).
- [ ] Memory retrieval/write path is active for conversation turns and observable in DB table `personality_memory_embeddings`.

---

## 5. Phase 2: RAG and Policy Navigation (Weeks 7–10)

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
- [ ] RAG failure path returns safe fallback and clarification prompt; `retrieval=degraded` set (Spec §12).

---

## 6. Phase 3: Reliability, Observability, and Security (Weeks 11–13)

### 6.1 Goals
- Harden failure handling, logging, and audit.
- Introduce gateway (shadow then active), model-tier routing, and operational SLOs.
- Align with security and privacy standards (Spec §17.4).

### 6.2 Tasks
- **Failure handling:** Implement Spec §12: detector fallback (keep prior stable traits), RAG fallback (no policy, ask clarification), verifier fallback (minimal claims), timeout fallback (controlled JSON only), EMA divergence alert.
- **Audit:** JSONL per turn with input hash, traits, retrieval IDs, citations, verifier decision (Spec §11); correlation IDs across frontend, orchestrator, DB.
- **Redaction:** Pseudonymized IDs in logs; no raw sensitive content in analytics (Spec §5, §17.4).
- **Gateway (optional but recommended):** Session lifecycle, correlation IDs, authN/authZ, rate limits, routing; shadow mode first (Spec §15.1.A, §15.1.G).
- **Model-tier router:** Light / medium / heavy tiers for cost-quality tradeoff; cannot skip grounding/verification (Spec §15.1.B).
- **Background jobs:** Corpus freshness checks, citation validity, retrieval regression suite (Spec §15.1.E).
- **SLO monitoring:** Gateway availability ≥ 99.9%; routing p95 ≤ 50ms; retrieval timeout ≤ 2.0s; verification ≤ 1.5s (Spec §15.1.F, §17.6).
- **Security:** Secrets in env only; least privilege; retention/deletion aligned with Swiss FADP; consent for personality profiling (Spec §17.4).

### 6.3 Deliverables (DoD)
- [ ] All failure paths return structured responses; no raw stack traces to clients.
- [ ] Audit JSONL and correlation IDs available for every turn.
- [ ] Optional feedback signals (e.g. thumbs up/down) captured for quality monitoring.
- [ ] If gateway is enabled: rollout plan followed (shadow → canary); success gate: no critical hallucination increase, stable or better benchmark scores (Spec §15.1.G).

---

## 7. Phase 4: Pilot Release and Evaluation (Weeks 14–16)

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

- **Technical spec:** `CareLoop/Technical-Specification-RAG-Policy-Navigation.md` (v1.2.0)
- **Requirements:** `pmt/Preliminary-Study-V2.7.6.md` (as referenced in spec)
- **Contracts:** Defined in spec §6 (request, detection, retrieval, response); implement in `packages/contracts`

---

## 9. Roadmap Changelog

- **1.1.0:** Locked architecture to Gemma 3 (NVIDIA key) and hybrid external memory (PostgreSQL + EMA + pgvector).
- **1.0.0:** Initial roadmap aligned with Technical Specification v1.2.0.
