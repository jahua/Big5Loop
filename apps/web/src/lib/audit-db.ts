/**
 * Phase 3 P1-3: optional audit log persistence to PostgreSQL.
 * When AUDIT_DB_WRITE=true and AUDIT_DATABASE_URL (or DATABASE_URL) is set,
 * writes each audit payload to the audit_log table. Fire-and-forget; does not block the response.
 * See docs/AUDIT-LOG-PERSISTENCE.md and infra/database/init.sql (audit_log table).
 */

import { Client } from "pg";
import type { AuditTurnPayload } from "./audit";

const AUDIT_DB_WRITE = process.env.AUDIT_DB_WRITE === "true" || process.env.AUDIT_DB_WRITE === "1";
const DB_URL = process.env.AUDIT_DATABASE_URL || process.env.DATABASE_URL || "";

const INSERT_SQL = `
  INSERT INTO audit_log (
    request_id, session_id, turn_index, coaching_mode,
    pipeline_status, routing, personality, retrieval_ids, citation_count,
    verifier_status, input_hash, turn_latency_ms
  ) VALUES ($1, $2::uuid, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::text[], $9, $10, $11, $12)
`;

/** Fire-and-forget write of one audit payload to audit_log. No-op if AUDIT_DB_WRITE or DB URL unset. */
export function writeAuditToDb(payload: AuditTurnPayload): void {
  if (!AUDIT_DB_WRITE || !DB_URL.trim()) return;

  const params = [
    payload.request_id || "",
    payload.session_id || "",
    payload.turn_index ?? 0,
    payload.coaching_mode || null,
    JSON.stringify(payload.pipeline_status || {}),
    payload.routing ? JSON.stringify(payload.routing) : null,
    payload.personality ? JSON.stringify(payload.personality) : null,
    payload.retrieval_ids && payload.retrieval_ids.length > 0 ? payload.retrieval_ids : null,
    payload.citation_count ?? null,
    payload.verifier_status || null,
    payload.input_hash || null,
    payload.turn_latency_ms ?? null,
  ];

  setImmediate(() => {
    const client = new Client({ connectionString: DB_URL });
    client
      .connect()
      .then(() => client.query(INSERT_SQL, params))
      .catch(() => {})
      .finally(() => client.end());
  });
}
