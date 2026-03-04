# Phase 3: Reliability, Observability, and Security

**CareLoop Development Report**  
**Version:** 1.0  
**Status:** Planned (Outlook)  
**Duration:** Weeks 11–13

---

## 1. Introduction

Phase 3 represents the production hardening phase of the CareLoop system. Building upon the functional dialogue capabilities established in Phases 1 and 2, this phase focuses on reliability engineering, observability infrastructure, and security compliance. The objective is to transform the functional prototype into a production-ready system capable of serving real users with appropriate safeguards, monitoring, and operational controls.

This document outlines the planned technical scope, implementation approach, and acceptance criteria for Phase 3 development.

## 2. Goals and Objectives

Phase 3 addresses three primary objectives:

**Objective 1: Failure Resilience**  
Implement comprehensive failure handling across all pipeline stages, ensuring graceful degradation under adverse conditions and preventing cascading failures from impacting user experience.

**Objective 2: Operational Visibility**  
Deploy observability infrastructure that enables real-time monitoring, anomaly detection, and root cause analysis for production incidents.

**Objective 3: Security Compliance**  
Align the system with Swiss data protection requirements (FADP) and implement security controls appropriate for processing sensitive caregiver information.

## 3. Technical Scope

### 3.1 Failure Handling Framework

The failure handling framework will implement defensive patterns for each pipeline stage:

#### 3.1.1 Detection Stage Failures

When the personality detection module fails or times out:
- Retain prior stable personality traits from the last successful detection
- Apply neutral style directives that avoid personality-specific adaptations
- Set `pipeline_status.detector = "degraded"`
- Continue processing with reduced personalization

Implementation approach:
```typescript
interface DetectionFallback {
  ocean: OceanScores;      // Last stable values from DB
  confidence: ConfidenceScores;  // Set to minimum (0.4)
  reasoning: "Detection unavailable; using cached profile";
  fallback: true;
}
```

#### 3.1.2 RAG Retrieval Failures

When policy retrieval fails or returns empty results:
- Suppress policy claims entirely
- Provide emotional support response appropriate to detected intent
- Include explicit acknowledgment and clarification request
- Set `pipeline_status.retrieval = "failed"`

This pattern was partially implemented in Phase 2; Phase 3 will formalize the failure taxonomy and ensure consistent behavior across failure modes (timeout, empty results, database connectivity issues).

#### 3.1.3 Generation Failures

When the NVIDIA API is unavailable or returns errors:
- Activate heuristic generation fallback (implemented in Phase 1)
- For policy turns, downgrade to support-only response
- Log generation failure with request context for debugging
- Set `pipeline_status.generator = "degraded"`

#### 3.1.4 Verification Failures

When the verification stage itself fails:
- Return minimal-claims safe response
- Exclude all policy assertions
- Include apology and suggestion to retry
- Set `pipeline_status.verifier = "error"`

#### 3.1.5 Timeout Budget Management

Global timeout budget: 15 seconds per turn
- Detection: 3.0s budget
- Retrieval: 2.0s budget
- Generation: 8.0s budget
- Verification: 1.5s budget
- Buffer: 0.5s

When any stage exceeds its budget, the system initiates graceful termination:
- Abort pending operations
- Return partial response if safe
- Otherwise return timeout fallback response
- Never return raw error messages or stack traces

### 3.2 Audit Logging Infrastructure

#### 3.2.1 JSONL Audit Format

Each turn will generate a structured audit record in JSONL format:

```json
{
  "timestamp": "2026-03-04T14:32:15.123Z",
  "request_id": "uuid",
  "session_id": "uuid",
  "turn_index": 5,
  "input_hash": "sha256:abc123...",
  "detection": {
    "ocean": {...},
    "confidence": {...},
    "latency_ms": 1523
  },
  "regulation": {
    "coaching_mode": "policy_navigation",
    "directives_count": 4
  },
  "retrieval": {
    "evidence_ids": ["iv_001", "iv_002"],
    "latency_ms": 412
  },
  "generation": {
    "model": "google/gemma-3-12b-it",
    "tokens_in": 892,
    "tokens_out": 156,
    "latency_ms": 3201
  },
  "verification": {
    "grounding_status": "ok",
    "blocked": false,
    "issues": []
  },
  "final_status": "success",
  "total_latency_ms": 5891
}
```

#### 3.2.2 Correlation IDs

All system components will propagate correlation IDs:
- `request_id`: Unique identifier per HTTP request
- `session_id`: User session identifier
- `trace_id`: Distributed tracing identifier (optional, for future APM integration)

Correlation IDs will be:
- Generated at the frontend/gateway layer
- Passed through N8N workflow context
- Included in all database writes
- Attached to all log entries

#### 3.2.3 Redaction Pipeline

Before persistent storage or analytics export, a redaction pipeline will process audit records:

**Redaction Rules:**
- User names → `[USER_NAME]`
- Email addresses → `[EMAIL]`
- Phone numbers → `[PHONE]`
- Swiss AHV numbers → `[AHV_NUMBER]`
- Free-text personal details → Hash or remove

Redaction occurs at the logging layer, ensuring raw sensitive content never reaches long-term storage.

### 3.3 Anomaly Monitoring

#### 3.3.1 Trait Shift Detection

Sudden personality trait shifts may indicate:
- Session hijacking or user confusion
- Detection model instability
- Adversarial prompt injection

Alert triggers:
- Any OCEAN trait shifts by >0.5 in a single turn
- EMA divergence exceeds historical baseline by 3σ
- Oscillating traits (>3 direction changes in 5 turns)

Response actions:
- Freeze EMA updates temporarily
- Revert to last stable state
- Emit `ema_divergence` alert for investigation

#### 3.3.2 Retrieval Quality Monitoring

Track retrieval effectiveness over time:
- Empty retrieval rate for policy queries
- Average evidence relevance scores
- Citation coverage gaps

Alert triggers:
- Empty retrieval rate >5% over 1-hour window
- Mean relevance score drops below threshold
- Repeated failures for specific query patterns

#### 3.3.3 Safety Event Tracking

Monitor for potential safety concerns:
- Grounding verification failures
- Blocked response rate increases
- User escalation patterns (repeated questions, frustration indicators)

### 3.4 Security Controls

#### 3.4.1 Secrets Management

All credentials and API keys will be:
- Stored in environment variables only
- Never logged or included in error messages
- Rotated according to security policy
- Scoped with least-privilege access

For production deployment, integration with a secrets manager (e.g., HashiCorp Vault, AWS Secrets Manager) is recommended.

#### 3.4.2 Access Control

N8N workflow access:
- Authentication required for workflow editor
- Webhook endpoints protected by API key validation
- Admin operations restricted to authorized personnel

Database access:
- Service accounts with minimal required permissions
- Separate read/write credentials where applicable
- Connection encryption (SSL/TLS) required

#### 3.4.3 Privacy Compliance (Swiss FADP)

The system will implement controls aligned with Swiss Federal Act on Data Protection:

**Data Minimization:**
- Collect only information necessary for service delivery
- Avoid storing raw conversation content longer than necessary
- Aggregate personality data for analytics rather than exporting raw profiles

**User Rights:**
- Support data export requests (personality profile, conversation history)
- Support data deletion requests (cascade delete across all tables)
- Provide clear disclosure of personality profiling functionality

**Consent Management:**
- Explicit consent required before personality profiling activation
- Option to use service without personality adaptation
- Clear explanation of how personality data influences responses

### 3.5 Gateway Service (Optional)

For production deployment, a dedicated Gateway service is recommended:

**Responsibilities:**
- Request authentication and authorization
- Rate limiting and abuse prevention
- Request correlation ID generation
- Routing decisions (intent mode + model tier)
- Response envelope standardization

**Rollout Strategy:**
1. Deploy in shadow mode (observe only)
2. Enable for 10% traffic (canary)
3. Validate metrics stability
4. Gradual rollout to 100%

The gateway pattern enables future enhancements:
- A/B testing infrastructure
- Traffic shaping and load management
- API versioning and deprecation
- Multi-region deployment support

## 4. Acceptance Criteria

### 4.1 Failure Handling

- [ ] All failure paths return structured JSON responses
- [ ] No raw stack traces or internal errors reach clients
- [ ] Timeout handling covers all pipeline stages
- [ ] Fallback responses are helpful and non-harmful

### 4.2 Observability

- [ ] JSONL audit records generated for 100% of turns
- [ ] Correlation IDs present in all database records
- [ ] Redaction pipeline processes all audit exports
- [ ] Anomaly alerts configured and tested

### 4.3 Security

- [ ] Zero hardcoded credentials in codebase
- [ ] All database connections use encryption
- [ ] Privacy controls documented and testable
- [ ] Consent flow implemented for personality profiling

## 5. Technical Dependencies

### 5.1 Infrastructure Requirements

- Log aggregation system (e.g., ELK stack, Loki)
- Metrics collection (e.g., Prometheus, Grafana)
- Alert routing (e.g., PagerDuty, Opsgenie)
- Secrets manager for production credentials

### 5.2 Development Effort Estimates

| Component | Complexity | Dependencies |
|-----------|------------|--------------|
| Failure handling framework | Medium | None |
| Audit logging infrastructure | Medium | Log aggregation system |
| Anomaly monitoring | Medium-High | Metrics collection |
| Security controls | Medium | Secrets manager |
| Gateway service | High | Optional, can defer |

## 6. Risk Assessment

### 6.1 Technical Risks

**Risk: Log volume overwhelms storage**  
Mitigation: Implement log rotation, retention policies, and sampling for high-volume events

**Risk: Redaction misses sensitive content**  
Mitigation: Regular audit of redaction rules, manual review sampling, pattern library updates

**Risk: Timeout budgets too aggressive**  
Mitigation: Initial deployment with relaxed timeouts, gradual tightening based on observed latencies

### 6.2 Schedule Risks

**Risk: Gateway development exceeds timeline**  
Mitigation: Gateway is optional for initial production; can deploy without it and add later

**Risk: Privacy compliance review delays**  
Mitigation: Early engagement with compliance team, incremental documentation

## 7. Success Metrics

### 7.1 Operational SLOs

| Metric | Target |
|--------|--------|
| System availability | ≥ 99.9% |
| Error response rate | < 0.1% |
| p95 end-to-end latency | Per-pillar targets |
| Audit record completeness | 100% |
| Correlation ID coverage | 100% |

### 7.2 Security KPIs

| Metric | Target |
|--------|--------|
| Secrets in code | 0 |
| Unencrypted connections | 0 |
| Privacy incident rate | 0 |
| Consent compliance | 100% |

## 8. Transition to Phase 4

Successful completion of Phase 3 enables pilot deployment:
- System resilience verified under failure conditions
- Operational visibility established for incident response
- Security and privacy controls validated
- Production deployment checklist completed

Phase 4 will focus on:
- Pilot user onboarding
- Full evaluation suite execution
- Load testing at scale
- Staged production rollout

---

**Document Control**  
Author: CareLoop Development Team  
Last Updated: 2026-03-04  
Status: Planning Document
