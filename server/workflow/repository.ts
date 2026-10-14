import type { AttachmentMetadata, AuditEventSummary, CalculationSnapshot, CaseWorkflowDetail, FtcCaseDraft, FtcCaseRecord, SnapshotSummary } from "../../shared/contracts.js";
import { DEMO_POLICY } from "../../shared/policy.js";
import type { PgQueryable } from "../postgres.js";
import { loadCaseRecord, type CaseRow } from "../app.js";

export interface AttachmentRow {
  id: string; case_id: string; source_id: string | null; kind: AttachmentMetadata["kind"];
  display_name: string; media_type: string; byte_size: number; sha256: string; status: AttachmentMetadata["status"];
  created_at: Date | string; storage_environment: string; storage_store: string; storage_region: string;
  storage_key: string; environment_marker_id: string | null; cleanup_pending: boolean;
}
export interface SnapshotRow {
  id: string; case_id: string; revision: number; kind: CalculationSnapshot["kind"];
  inputs: FtcCaseDraft | string; result: CalculationSnapshot["result"] | string;
  evidence: CalculationSnapshot["evidence"] | string; policy: CalculationSnapshot["policy"] | string;
  policy_id: string; engine_version: string; created_at: Date | string;
}

export function attachmentMetadata(row: AttachmentRow): AttachmentMetadata {
  return { id: row.id, caseId: row.case_id, sourceId: row.source_id, kind: row.kind, displayName: row.display_name,
    mediaType: row.media_type, byteSize: row.byte_size, sha256: row.sha256, status: row.status,
    createdAt: new Date(row.created_at).toISOString() };
}

function jsonValue<T>(value: T | string): T { return typeof value === "string" ? JSON.parse(value) as T : value; }

export function snapshotRecord(row: SnapshotRow): CalculationSnapshot {
  return { id: row.id, caseId: row.case_id, revision: row.revision, kind: row.kind,
    inputs: jsonValue(row.inputs), result: jsonValue(row.result), evidence: jsonValue(row.evidence),
    policy: jsonValue(row.policy), createdAt: new Date(row.created_at).toISOString() };
}

export async function getAttachments(query: Pick<PgQueryable, "query">, caseId: string, markerId: string): Promise<{ rows: AttachmentRow[]; metadata: AttachmentMetadata[] }> {
  const result = await query.query<AttachmentRow>(
    `SELECT id,case_id,source_id,kind,display_name,media_type,byte_size,sha256,status,created_at,
       storage_environment,storage_store,storage_region,storage_key,environment_marker_id,cleanup_pending
     FROM attachments WHERE case_id=$1 AND environment_marker_id=$2 ORDER BY created_at,id`, [caseId, markerId]);
  return { rows: result.rows, metadata: result.rows.filter((row) => row.status !== "deleted").map(attachmentMetadata) };
}

export async function getLatestCurrentPreview(query: Pick<PgQueryable, "query">, caseId: string, revision: number): Promise<CalculationSnapshot | null> {
  const result = await query.query<SnapshotRow>(
    `SELECT * FROM calculation_snapshots WHERE case_id=$1 AND revision=$2 AND kind='preview'
     AND policy_id=$3 AND engine_version=$4 ORDER BY created_sequence DESC LIMIT 1`,
    [caseId, revision, DEMO_POLICY.id, DEMO_POLICY.engineVersion]);
  return result.rows[0] ? snapshotRecord(result.rows[0]) : null;
}

export async function getSnapshotSummaries(query: Pick<PgQueryable, "query">, caseId: string): Promise<SnapshotSummary[]> {
  const result = await query.query<SnapshotRow>(
    `SELECT id,case_id,revision,kind,policy_id,engine_version,result,created_at FROM calculation_snapshots
     WHERE case_id=$1 ORDER BY created_sequence DESC LIMIT 20`, [caseId]);
  return result.rows.map((row) => ({ id: row.id, revision: row.revision, kind: row.kind, policyId: row.policy_id,
    engineVersion: row.engine_version, outcome: jsonValue<SnapshotRow["result"]>(row.result) instanceof Object
      ? (jsonValue<SnapshotRow["result"]>(row.result) as { outcome: SnapshotSummary["outcome"] }).outcome : "incomplete",
    createdAt: new Date(row.created_at).toISOString() }));
}

export async function getAuditSummaries(query: Pick<PgQueryable, "query">, caseId: string): Promise<AuditEventSummary[]> {
  const result = await query.query<{ id: string; event_type: string; display_name: string; login_name: string; occurred_at: Date | string }>(
    `SELECT audit.id,audit.event_type,users.display_name,users.login_name,audit.occurred_at
     FROM audit_events audit JOIN app_users users ON users.id=audit.actor_id
     WHERE audit.case_id=$1 ORDER BY audit.created_sequence DESC LIMIT 20`, [caseId]);
  return result.rows.map((row) => ({ id: row.id, event: row.event_type, actor: row.display_name || row.login_name, occurredAt: new Date(row.occurred_at).toISOString() }));
}

export async function loadWorkflowCase(query: Pick<PgQueryable, "query">, row: CaseRow, markerId: string): Promise<CaseWorkflowDetail> {
  const record = await loadCaseRecord(query, row);
  const attachments = await getAttachments(query, row.id, markerId);
  return { case: record, attachments: attachments.metadata,
    currentPreview: await getLatestCurrentPreview(query, row.id, row.revision),
    snapshotSummaries: await getSnapshotSummaries(query, row.id),
    auditEvents: await getAuditSummaries(query, row.id) };
}

export async function incrementCaseRevision(client: Pick<PgQueryable, "query">, caseId: string): Promise<CaseRow> {
  const result = await client.query<CaseRow>(
    `UPDATE ftc_cases SET revision=revision+1, updated_at=now(),
       draft=jsonb_set(draft,'{revision}',to_jsonb(revision+1),true)
     WHERE id=$1 RETURNING *`, [caseId]);
  return result.rows[0]!;
}

export async function appendAudit(client: Pick<PgQueryable, "query">, actorId: string, caseId: string, event: string, snapshotId?: string): Promise<void> {
  await client.query("INSERT INTO audit_events(actor_id,case_id,snapshot_id,event_type) VALUES ($1,$2,$3,$4)",
    [actorId, caseId, snapshotId ?? null, event]);
}

export function decodeCaseDraft(record: FtcCaseRecord): FtcCaseDraft { return record.draft; }
