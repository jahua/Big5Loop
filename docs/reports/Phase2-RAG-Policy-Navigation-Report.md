# Phase 2: RAG and Policy Navigation Implementation

**CareLoop Development Report**  
**Version:** 1.0  
**Status:** Completed  
**Duration:** Weeks 7–10

---

## 1. Introduction

Phase 2 extended the CareLoop dialogue system with Retrieval-Augmented Generation (RAG) capabilities for policy navigation. This phase implemented the Policy Navigation pillar, enabling the assistant to provide grounded, citation-backed responses to queries about Swiss caregiver support policies, benefits, and procedures. The core design principle maintained strict separation between factual policy retrieval and personality-dependent presentation styling, ensuring that policy facts remain invariant regardless of how they are communicated to the user.

## 2. Design Principles

The RAG implementation adheres to three fundamental principles derived from the technical specification:

**Principle 1: Evidence-Grounded Claims**  
Every policy assertion in the assistant's response must map to at least one retrieved evidence chunk. The system enforces a hard constraint: no policy claim without source evidence. This eliminates the risk of hallucinated policy information that could mislead caregivers about their entitlements or procedures.

**Principle 2: Personality-Safe Styling**  
Personality adaptation affects only the presentation layer. Policy facts (eligibility criteria, monetary amounts, deadlines, procedures) are rendered exactly as retrieved, with personality-based styling limited to tone, structure, and framing. A high-conscientiousness user receives the same facts as a low-conscientiousness user, but in a more structured checklist format.

**Principle 3: Graceful Degradation**  
When retrieval fails or returns insufficient evidence, the system degrades safely by withholding policy assertions and requesting clarification. Users receive honest acknowledgment of the system's limitations rather than fabricated information.

## 3. Technical Implementation

### 3.1 Policy Corpus and Database Schema

The policy corpus is stored in a PostgreSQL database with pgvector extension for embedding-based similarity search. The `policy_chunks` table schema supports hybrid retrieval:

```sql
CREATE TABLE policy_chunks (
    chunk_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_tsv TSVECTOR,
    embedding VECTOR(1536),
    jurisdiction TEXT DEFAULT 'federal',
    authority_tier INTEGER DEFAULT 3,
    validation_status TEXT DEFAULT 'approved',
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

The schema includes governance fields (`validation_status`, `expires_at`, `authority_tier`) that support corpus quality control. Only chunks with `validation_status='approved'` and non-expired `expires_at` are eligible for production retrieval.

Initial corpus seeding focused on the IV (Invalidenversicherung / Disability Insurance) domain pack, including:
- Eligibility criteria and requirements
- Application procedures and timelines
- Required documentation checklists
- Cantonal contact information

### 3.2 Policy Intent Detection

The intent detection module identifies policy-relevant queries through keyword analysis and semantic scoring. Policy indicators include:

- Benefit type mentions: IV, AHV, Hilflosenentschädigung, EL
- Procedural keywords: application, eligibility, requirements, forms
- Legal/administrative terms: entitlement, deadline, decision, appeal

The intent classifier outputs a policy score in [0.0, 1.0]. When the policy score exceeds 0.55, or when explicit legal/benefit trigger terms are detected, the turn is routed to the policy navigation pipeline.

Benchmark validation achieved 100% routing accuracy on a test set of six representative queries spanning policy navigation, mixed mode, practical education, and emotional support categories.

### 3.3 Hybrid Retrieval Pipeline

The retrieval pipeline implements a hybrid approach combining vector similarity and lexical matching:

**Vector Retrieval Path**  
Query text is embedded using the same model that generated corpus embeddings. Cosine similarity identifies semantically related chunks, effective for paraphrased queries and conceptual matches.

**Lexical Retrieval Path**  
PostgreSQL full-text search (`plainto_tsquery`, `websearch_to_tsquery`) identifies chunks containing exact keyword matches. This path excels at capturing specific legal terms, policy identifiers, and proper nouns that embedding models may not preserve precisely.

**Score Fusion**  
Results from both paths are combined using weighted fusion:

```
final_score = 0.70 × vector_score + 0.30 × lexical_score + rerank_boost
```

Rerank boosts are applied for:
- Jurisdiction match (federal/cantonal alignment): +0.08
- Higher authority source tier: +0.05
- Recency within policy validity window: +0.03

The top k=5 chunks after fusion are retained, with the top 3 passed to generation based on token budget constraints.

### 3.4 Evidence Packaging

Retrieved chunks are packaged into a structured evidence array conforming to the RAG Retrieval Output contract:

```json
{
  "mode": "policy_navigation",
  "query_rewrite": "IV eligibility requirements Switzerland",
  "top_k": 3,
  "evidence": [
    {
      "source_id": "iv_guideline_2025_01",
      "title": "IV Eligibility Criteria",
      "url": "https://www.ahv-iv.ch/...",
      "chunk_id": "iv_elig_001",
      "excerpt": "To qualify for IV benefits, the insured person must..."
    }
  ]
}
```

Each evidence item includes provenance metadata (source_id, title, URL) enabling citation generation and user verification of information sources.

### 3.5 Citation Integration

The generation module incorporates retrieved evidence into the response synthesis prompt. The prompt structure explicitly instructs the model:

```
OFFICIAL POLICY CONTEXT (Use this to answer):
[Source 1]: IV Eligibility Criteria - To qualify for IV benefits...
[Source 2]: Application Process - Applications must be submitted...

INSTRUCTIONS: Answer the user's question using ONLY the provided context. 
If the answer is not in the context, say you don't know. 
Do not hallucinate rules.
```

Citations are packaged in the final response within the `policy_navigation` object:

```json
{
  "policy_navigation": {
    "active": true,
    "citations": [
      {
        "source_id": "iv_guideline_2025_01",
        "title": "IV Eligibility Criteria",
        "url": "https://www.ahv-iv.ch/..."
      }
    ]
  }
}
```

### 3.6 Grounding Verifier

A dedicated Grounding Verifier node was implemented between the Generation and Verification stages. This module performs claim-to-evidence mapping validation:

**Claim Detection**  
The verifier scans generated responses for policy claim patterns:
- Eligibility statements ("you must...", "requirements include...")
- Monetary references ("CHF", amounts, percentages)
- Temporal claims (deadlines, processing times)
- Legal identifiers (IV, AHV, specific regulation references)

**Evidence Mapping**  
Each detected claim is matched against the retrieved evidence chunks. A claim is considered grounded if:
- The evidence contains semantically equivalent information
- The claim does not introduce facts absent from evidence
- Numerical values match exactly (no approximation allowed)

**Grounding Status**  
The verifier outputs one of three status values:

| Status | Condition | Action |
|--------|-----------|--------|
| `ok` | All claims map to evidence | Proceed with response |
| `degraded` | Some claims lack strong evidence | Add uncertainty markers |
| `failed` | Critical claims ungrounded | Block response; return fallback |

When grounding fails, the system returns a safe fallback response that acknowledges the query without making unsupported assertions:

```
"I found some information about IV, but I want to make sure I give you 
accurate details. Could you tell me more specifically what aspect of 
IV eligibility you'd like to know about?"
```

### 3.7 Mixed-Mode Composition

For turns where both emotional support and policy information are needed (`coaching_mode: mixed`), the system composes a two-segment response:

**Support Segment**  
Addresses the emotional dimension of the query with personality-adapted reassurance and validation. This segment contains no policy claims and requires no citations.

**Policy Segment**  
Delivers evidence-grounded policy information with full citation coverage. This segment maintains strict grounding requirements regardless of the preceding support content.

The composition template ensures clear separation:

```json
{
  "coaching_mode": "mixed",
  "message": {
    "content": "<support segment>\n\n<policy segment>"
  },
  "segments": [
    {"type": "support", "tokens": 80},
    {"type": "policy", "tokens": 110}
  ],
  "policy_navigation": {
    "active": true,
    "citations": [...]
  }
}
```

### 3.8 Degraded Fallback Handling

When retrieval fails or returns no relevant evidence, the system activates degraded mode:

1. **Pipeline Status Update**: `pipeline_status.retrieval = "degraded"`
2. **Response Modification**: Policy claims are withheld; response focuses on emotional support
3. **Clarification Request**: User is prompted to rephrase or provide additional context
4. **Explicit Disclosure**: Response acknowledges the system's current limitation

Example degraded response:
```
"I understand you're looking for information about disability benefits. 
I want to make sure I give you accurate information, but I'm having 
trouble finding the specific details right now. Could you tell me more 
about your situation, or try asking about a specific aspect like 
eligibility requirements or the application process?"
```

## 4. Testing and Validation

### 4.1 Retrieval Verification

The hybrid retrieval system was tested with policy-related queries:

```bash
# Test query
curl -X POST http://localhost:5678/webhook/careloop-turn \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test","turn_index":1,"message":"What are the eligibility rules for IV in Switzerland?"}'
```

Results confirmed:
- 3 relevant chunks retrieved for IV eligibility queries
- Evidence array correctly populated with source metadata
- Citations present in final response

### 4.2 Grounding Verification

The grounding verifier was tested with both legitimate and potentially hallucinated responses:

**Legitimate Response Test**: Response derived entirely from evidence → `grounding_status: ok`

**Hallucination Injection Test**: Response with fabricated eligibility criteria → `grounding_status: failed`, response blocked

### 4.3 Policy Intent Benchmark

The `scripts/policy-intent-check.js` benchmark validated routing accuracy:

```bash
npm run test:intent:policy
```

Results: 100% (6/6) correct routing across categories:
- Policy navigation queries → `policy_navigation`
- Mixed intent queries → `mixed`
- Education queries → `practical_education`
- Emotional queries → `emotional_support`

## 5. Deliverables Achieved

| Criterion | Status | Notes |
|-----------|--------|-------|
| Policy intent detection | ✅ | 100% benchmark accuracy |
| Hybrid retrieval (vector + lexical) | ✅ | PostgreSQL tsquery + pgvector |
| Citation packaging | ✅ | All policy responses include citations |
| Grounding verifier | ✅ | Claim-to-evidence mapping operational |
| Degraded fallback | ✅ | Safe behavior on retrieval failure |
| Mixed-mode composition | ✅ | Support + policy segments |

### 5.1 Deferred Items

The following items were deferred to post-Phase 3:
- `ENABLE_RAG_POLICY_NAV` feature flag for controlled rollout
- Complete IV domain pack with full FAQ benchmark coverage
- Policy benchmark suite with automated evaluator protocol
- p95 latency validation for policy navigation (target: ≤8.0s)

## 6. Architecture Decisions

### 6.1 Retrieval in Workflow vs. Microservice

The retrieval logic was implemented directly in N8N workflow nodes rather than as a separate microservice. This decision prioritized:
- Reduced latency (no additional HTTP round-trip)
- Simplified deployment (fewer services to manage)
- Direct access to PostgreSQL from workflow context

For future scaling, the retrieval logic can be extracted to a dedicated service without architectural changes to the workflow interface.

### 6.2 Grounding Before Generation vs. After

The grounding verifier operates after generation rather than constraining generation directly. This approach:
- Allows the model maximum flexibility in response formulation
- Catches hallucinations regardless of their source (model behavior, prompt injection)
- Provides clear audit trail of blocked responses

The tradeoff is potential wasted computation on responses that are ultimately blocked, but this is preferable to the complexity of generation-time constraints.

## 7. Performance Observations

Retrieval-augmented turns exhibit higher latency than non-policy turns:

| Stage | Duration |
|-------|----------|
| Intent Classification | ~100ms |
| Retrieval (hybrid) | ~300-500ms |
| Evidence Packaging | ~50ms |
| Generation (with context) | ~3.0-4.0s |
| Grounding Verification | ~100-200ms |
| **Total** | **~4.0-5.5s** |

These measurements fall within the p95 target of ≤8.0s for policy navigation, though production deployment may require optimization for high-load scenarios.

## 8. Lessons Learned

### 8.1 Evidence Quality Critical

The quality of retrieved evidence directly determines response quality. Poorly chunked or outdated policy documents led to suboptimal responses during development. Corpus governance (validation status, expiration tracking) proved essential.

### 8.2 Grounding Patterns

Policy claim detection required iterative refinement. Initial patterns missed subtle eligibility claims while over-matching on general statements. The final pattern set balances precision and recall for Swiss policy domain vocabulary.

### 8.3 Fallback User Experience

Users respond better to honest acknowledgment of limitations than to vague or hedged responses. The explicit clarification request in degraded mode received positive feedback during internal testing.

## 9. Transition to Phase 3

Phase 2 established evidence-grounded policy navigation. Phase 3 will strengthen the system with:
- Comprehensive failure handling across all pipeline stages
- Structured audit logging with correlation IDs
- Security hardening and privacy controls
- Operational SLO monitoring and alerting

The grounding verifier architecture provides the foundation for the broader verification and safety systems required in Phase 3.

---

**Document Control**  
Author: CareLoop Development Team  
Last Updated: 2026-03-04
